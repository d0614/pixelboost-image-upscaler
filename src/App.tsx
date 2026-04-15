import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, Download, Image as ImageIcon, X, Grid3X3, Check, Loader2, Scissors, Wand2, Maximize2 } from 'lucide-react';
import { detectGrid } from './utils/gridDetection';
import { initModel, upscaleWithAI, isModelReady } from './utils/aiUpscaler';

interface TileData {
  row: number;
  col: number;
  blobUrl: string;
  originalWidth: number;
  originalHeight: number;
  newWidth: number;
  newHeight: number;
}

export default function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rows, setRows] = useState(1);
  const [cols, setCols] = useState(1);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [tiles, setTiles] = useState<TileData[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [imgDimensions, setImgDimensions] = useState<{ w: number; h: number } | null>(null);
  const [modelStatus, setModelStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [modelProgress, setModelProgress] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 启动时自动加载 AI 超分模型
  useEffect(() => {
    initModel((p) => {
      if (p.status === 'progress') setModelProgress(Math.round(p.progress));
    }).then((ok) => {
      setModelStatus(ok ? 'ready' : 'error');
    });
  }, []);

  const handleFile = (file: File) => {
    if (file && file.type.startsWith('image/')) {
      setSelectedFile(file);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      tiles.forEach(t => URL.revokeObjectURL(t.blobUrl));

      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      setTiles([]);
      setImgDimensions(null);
      setRows(1);
      setCols(1);

      // 读取图片尺寸并自动检测网格
      const img = new Image();
      img.onload = async () => {
        setImgDimensions({ w: img.width, h: img.height });
        
        // 自动检测网格布局
        setIsDetecting(true);
        try {
          // 给一点UI响应时间
          await new Promise(r => setTimeout(r, 100));
          const result = await detectGrid(img);
          setRows(result.rows);
          setCols(result.cols);
        } catch (e) {
          console.error("Grid detection failed:", e);
        } finally {
          setIsDetecting(false);
        }
      };
      img.src = url;
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };

  const onDragLeave = () => {
    setDragActive(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const clearImage = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    tiles.forEach(t => URL.revokeObjectURL(t.blobUrl));

    setSelectedFile(null);
    setPreviewUrl(null);
    setTiles([]);
    setImgDimensions(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const processAndUpscale = useCallback(async () => {
    if (!previewUrl) return;

    setIsProcessing(true);
    setProcessingProgress(0);
    // 清除旧 tiles
    tiles.forEach(t => URL.revokeObjectURL(t.blobUrl));
    setTiles([]);

    const img = new Image();
    img.src = previewUrl;

    img.onload = async () => {
      const tileWidth = Math.floor(img.width / cols);
      const tileHeight = Math.floor(img.height / rows);
      const newTiles: TileData[] = [];
      const totalTiles = rows * cols;
      let completedTiled = 0;

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          // 步骤 1: 切片
          const croppedCanvas = document.createElement('canvas');
          croppedCanvas.width = tileWidth;
          croppedCanvas.height = tileHeight;
          const croppedCtx = croppedCanvas.getContext('2d');
          if (!croppedCtx) continue;

          croppedCtx.drawImage(
            img,
            col * tileWidth, row * tileHeight,
            tileWidth, tileHeight,
            0, 0,
            tileWidth, tileHeight
          );

          // 步骤 2: AI 超分到 1080p（Swin2SR 神经网络）
          const upscaleResult = await upscaleWithAI(croppedCanvas, 1080);

          const blob = await new Promise<Blob | null>((resolve) =>
            upscaleResult.canvas.toBlob(resolve, 'image/jpeg', 0.95)
          );

          if (blob) {
            newTiles.push({
              row,
              col,
              blobUrl: URL.createObjectURL(blob),
              originalWidth: upscaleResult.originalWidth,
              originalHeight: upscaleResult.originalHeight,
              newWidth: upscaleResult.newWidth,
              newHeight: upscaleResult.newHeight,
            });
          }

          completedTiled++;
          setProcessingProgress(Math.round((completedTiled / totalTiles) * 100));
          
          // 给UI渲染喘息的时间，防止浏览器卡死
          await new Promise(r => setTimeout(r, 50));
        }
      }

      setTiles(newTiles);
      setIsProcessing(false);
    };

    img.onerror = () => {
      setIsProcessing(false);
      alert('Failed to load image for processing.');
    };
  }, [previewUrl, rows, cols, tiles]);

  const downloadTile = (tile: TileData) => {
    if (!selectedFile) return;
    const link = document.createElement('a');
    const fileName = selectedFile.name.replace(/\.[^/.]+$/, '');
    link.download = `${fileName}_r${tile.row + 1}_c${tile.col + 1}_hd.jpg`;
    link.href = tile.blobUrl;
    link.click();
  };

  const downloadAllTiles = () => {
    tiles.forEach((tile, i) => {
      setTimeout(() => downloadTile(tile), i * 300);
    });
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5] text-[#1A1A1A] font-sans selection:bg-emerald-100">
      {/* Header */}
      <header className="max-w-7xl mx-auto px-6 py-8 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-tr from-emerald-500 to-teal-400 rounded-xl flex items-center justify-center text-white shadow-lg shadow-emerald-200">
            <Wand2 size={24} className="animate-pulse" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">PixelBoost <span className="text-emerald-500 font-black">AI</span></h1>
        </div>
        <div className="text-sm text-gray-500 font-medium hidden sm:flex items-center gap-2">
           {modelStatus === 'loading' ? (
             <>
               <Loader2 size={14} className="animate-spin text-amber-500" />
               <span className="text-amber-600">Loading AI Model... {modelProgress}%</span>
             </>
           ) : modelStatus === 'ready' ? (
             <>
               <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
               <span>Swin2SR AI Engine Ready</span>
             </>
           ) : (
             <>
               <span className="flex h-2 w-2 rounded-full bg-gray-400"></span>
               <span className="text-gray-400">AI unavailable · Canvas mode</span>
             </>
           )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 pb-12">
        <div className="grid lg:grid-cols-12 gap-8">

          {/* Left Column: Controls & Upload */}
          <div className="lg:col-span-4 space-y-6">
            <section className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-6 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center text-[10px] text-gray-500">1</span>
                Upload Image
              </h2>

              <div
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onClick={() => !selectedFile && fileInputRef.current?.click()}
                className={`
                  relative border-2 border-dashed rounded-2xl transition-all duration-300 cursor-pointer
                  flex flex-col items-center justify-center p-8 text-center
                  ${dragActive ? 'border-emerald-500 bg-emerald-50/50' : 'border-gray-200 hover:border-emerald-400 hover:bg-gray-50'}
                  ${selectedFile ? 'border-emerald-500/30 bg-emerald-50/10' : 'h-64'}
                `}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="image/*"
                  className="hidden"
                />

                {selectedFile ? (
                  <div className="space-y-4 w-full">
                    <div className="flex items-center justify-between bg-white p-3 rounded-xl shadow-sm border border-emerald-100">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <ImageIcon className="text-emerald-500 shrink-0" size={20} />
                        <span className="text-sm font-medium truncate">{selectedFile.name}</span>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); clearImage(); }}
                        className="p-1.5 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded-lg transition-colors"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 flex items-center justify-center gap-2">
                      <span>{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</span>
                      {imgDimensions && (
                        <>
                          <span>•</span>
                          <span>{imgDimensions.w} × {imgDimensions.h} px</span>
                        </>
                      )}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-4 text-gray-400 group-hover:bg-emerald-50 group-hover:text-emerald-500 transition-colors">
                      <Upload size={24} />
                    </div>
                    <p className="text-sm font-medium text-gray-600">Click or drag image to upload</p>
                    <p className="text-xs text-gray-400 mt-2">Supports JPG, PNG, WEBP</p>
                  </>
                )}
              </div>
            </section>

            <section className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 relative overflow-hidden">
              {/* Magic dust effect background for AI section */}
              <div className="absolute top-0 right-0 -mr-8 -mt-8 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>
              
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center text-[10px] text-gray-500">2</span>
                  AI Processing
                </div>
                <div className="flex items-center gap-1.5 text-[10px] bg-emerald-50 text-emerald-600 px-2 py-1 rounded-full font-bold">
                  <Wand2 size={12} />
                  AUTO-DETECT
                </div>
              </h2>

              <div className="space-y-6">
                <div className="bg-gradient-to-b from-gray-50 to-white border border-gray-100 p-4 rounded-2xl">
                  {isDetecting ? (
                    <div className="flex flex-col items-center justify-center py-4 space-y-3">
                      <div className="relative">
                        <div className="absolute inset-0 border-4 border-emerald-200 rounded-full animate-ping opacity-50"></div>
                        <Wand2 className="text-emerald-500 animate-pulse relative z-10" size={32} />
                      </div>
                      <p className="text-sm font-bold text-gray-600">Analyzing Grid Structure...</p>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <label className="text-xs font-bold uppercase tracking-widest text-gray-400">Grid Layout</label>
                        {selectedFile && (
                          <span className="text-xs text-emerald-500 bg-emerald-50 px-2 py-0.5 rounded font-bold">AI Detected</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <span className="block text-[10px] text-gray-400 mb-1.5 text-center">ROWS</span>
                          <div className="flex items-center gap-1">
                            <button onClick={() => { setRows(Math.max(1, rows - 1)); setTiles([]); }} className="w-8 h-10 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 font-bold transition-colors">−</button>
                            <input
                              type="number" min={1} max={20} value={rows}
                              onChange={(e) => { setRows(Math.max(1, Math.min(20, parseInt(e.target.value) || 1))); setTiles([]); }}
                              className="flex-1 py-2.5 px-2 rounded-xl font-black text-xl text-center bg-white text-gray-800 border-2 border-gray-200 focus:border-emerald-500 outline-none transition-all w-12"
                            />
                            <button onClick={() => { setRows(Math.min(20, rows + 1)); setTiles([]); }} className="w-8 h-10 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 font-bold transition-colors">+</button>
                          </div>
                        </div>
                        <span className="text-gray-300 font-bold text-lg mt-5">×</span>
                        <div className="flex-1">
                          <span className="block text-[10px] text-gray-400 mb-1.5 text-center">COLS</span>
                          <div className="flex items-center gap-1">
                            <button onClick={() => { setCols(Math.max(1, cols - 1)); setTiles([]); }} className="w-8 h-10 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 font-bold transition-colors">−</button>
                            <input
                              type="number" min={1} max={20} value={cols}
                              onChange={(e) => { setCols(Math.max(1, Math.min(20, parseInt(e.target.value) || 1))); setTiles([]); }}
                              className="flex-1 py-2.5 px-2 rounded-xl font-black text-xl text-center bg-white text-gray-800 border-2 border-gray-200 focus:border-emerald-500 outline-none transition-all w-12"
                            />
                            <button onClick={() => { setCols(Math.min(20, cols + 1)); setTiles([]); }} className="w-8 h-10 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 font-bold transition-colors">+</button>
                          </div>
                        </div>
                      </div>
                      <p className="text-[11px] text-gray-400 mt-3 flex items-center gap-1.5 justify-center">
                        <Maximize2 size={12} />
                        {rows * cols} tiles → auto upscale to <strong className="text-gray-600">HD 1080p</strong>
                      </p>
                    </div>
                  )}
                </div>

                <button
                  disabled={!selectedFile || isProcessing || isDetecting}
                  onClick={processAndUpscale}
                  className={`
                    w-full py-4 rounded-2xl font-bold flex flex-col items-center justify-center gap-1 transition-all
                    ${!selectedFile || isProcessing || isDetecting
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-gradient-to-r from-[#1A1A1A] to-[#2D2D2D] text-white hover:shadow-xl hover:shadow-gray-300 active:scale-[0.98]'}
                  `}
                >
                  {isProcessing ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="animate-spin" size={20} />
                      Processing {processingProgress}%
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                       <Wand2 size={20} className={!selectedFile ? "" : "text-emerald-400"} />
                       Split & Upscale to HD
                    </span>
                  )}
                  {isProcessing && (
                    <div className="w-48 h-1 bg-gray-700 rounded-full mt-2 overflow-hidden">
                       <div className="h-full bg-emerald-400 transition-all duration-300" style={{width: `${processingProgress}%`}}></div>
                    </div>
                  )}
                </button>
              </div>
            </section>

            {tiles.length > 0 && (
              <section className="bg-gradient-to-br from-emerald-500 to-teal-500 rounded-3xl p-6 shadow-xl shadow-emerald-200 text-white relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10"><Maximize2 size={80} /></div>
                <h2 className="text-sm font-semibold uppercase tracking-wider opacity-90 mb-4 relative z-10 flex items-center gap-2">
                  <Check size={16} /> Ready for Download
                </h2>
                <div className="mb-4 text-emerald-50 text-sm relative z-10">
                  Successfully generated and upscaled <strong>{tiles.length}</strong> HD images.
                </div>
                <button
                  onClick={downloadAllTiles}
                  className="relative z-10 w-full bg-white text-emerald-600 py-4 rounded-xl font-black flex items-center justify-center gap-2 hover:bg-emerald-50 hover:shadow-lg transition-all active:scale-[0.98]"
                >
                  <Download size={20} />
                  Download All ZIP / Images
                </button>
              </section>
            )}
          </div>

          {/* Right Column: Preview */}
          <div className="lg:col-span-8">
            <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-gray-100 h-full flex flex-col min-h-[600px] relative overflow-hidden">
              
              <div className="flex items-center justify-between mb-8 relative z-10">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  Live Preview
                  {isProcessing && <Loader2 size={16} className="animate-spin text-emerald-500" />}
                </h2>
                {tiles.length > 0 && (
                  <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-4 py-1.5 rounded-full text-sm font-bold shadow-sm border border-emerald-100">
                    <Maximize2 size={16} />
                    HD Upscaled • {tiles.length} tiles
                  </div>
                )}
              </div>

              {/* Visualization Area */}
              <div className="flex-1 relative bg-gray-50/50 rounded-2xl overflow-hidden border border-gray-100 flex items-center justify-center p-4">
                
                {/* Background grid pattern for empty state */}
                {!previewUrl && (
                  <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEiIGZpbGw9InJnYmEoMCwwLDAsMC4wNSkiLz48L3N2Zz4=')] opacity-50"></div>
                )}

                {!previewUrl ? (
                  <div className="text-center space-y-4 relative z-10">
                    <div className="w-24 h-24 bg-white rounded-3xl shadow-sm border border-gray-100 flex items-center justify-center mx-auto text-gray-200">
                      <ImageIcon size={48} />
                    </div>
                    <div>
                      <p className="text-gray-400 font-medium text-lg">Awaiting Image</p>
                      <p className="text-gray-400 text-sm mt-1">Upload an image to see the magic happen</p>
                    </div>
                  </div>
                ) : tiles.length > 0 ? (
                  /* Tile grid preview (Upscaled Results) */
                  <div
                    className="grid gap-3 w-full h-full p-2"
                    style={{
                      gridTemplateColumns: `repeat(${cols}, 1fr)`,
                      gridTemplateRows: `repeat(${rows}, 1fr)`,
                    }}
                  >
                    {tiles.map((tile) => (
                      <div
                        key={`${tile.row}-${tile.col}`}
                        className="relative group rounded-xl overflow-hidden border-2 border-transparent hover:border-emerald-400 bg-white cursor-pointer shadow-sm hover:shadow-xl transition-all duration-300"
                        onClick={() => downloadTile(tile)}
                      >
                         {/* Checkered background for transparent images */}
                        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSIjZjBmMGYwIj48L3JlY3Q+CjxyZWN0IHg9IjQiIHk9IjQiIHdpZHRoPSI0IiBoZWlnaHQ9IjQiIGZpbGw9IiNmMGYwZjAiPjwvcmVjdD4KPC9zdmc+')] opacity-20"></div>
                        
                        <img
                          src={tile.blobUrl}
                          alt={`Tile ${tile.row + 1}-${tile.col + 1}`}
                          className="relative z-10 w-full h-full object-contain"
                        />
                        
                        {/* Hover Overlay */}
                        <div className="absolute inset-0 z-20 bg-emerald-900/0 group-hover:bg-emerald-900/60 transition-all duration-300 flex items-center justify-center backdrop-blur-[0px] group-hover:backdrop-blur-sm">
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col items-center gap-2 transform translate-y-4 group-hover:translate-y-0">
                            <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-emerald-500 shadow-lg">
                              <Download size={24} />
                            </div>
                            <span className="text-white text-sm font-bold">Save HD Tile</span>
                            <span className="text-emerald-200 text-xs font-mono">{tile.newWidth}×{tile.newHeight}</span>
                          </div>
                        </div>

                        {/* Badges */}
                        <div className="absolute top-2 left-2 z-20 flex flex-col gap-1">
                          <div className="bg-black/70 backdrop-blur-md text-white text-[10px] font-black px-2 py-1 rounded">
                            R{tile.row + 1} C{tile.col + 1}
                          </div>
                        </div>
                        <div className="absolute bottom-2 right-2 z-20">
                          <div className="bg-emerald-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm flex items-center gap-1">
                            <Maximize2 size={8} /> HD
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  /* Original image with grid overlay */
                  <div className="relative w-full h-full p-4 flex items-center justify-center">
                    <div className="relative inline-block border-4 border-white shadow-xl rounded-lg overflow-hidden">
                       <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSIjZjBmMGYwIj48L3JlY3Q+CjxyZWN0IHg9IjQiIHk9IjQiIHdpZHRoPSI0IiBoZWlnaHQ9IjQiIGZpbGw9IiNmMGYwZjAiPjwvcmVjdD4KPC9zdmc+')] opacity-20"></div>
                      <img
                        src={previewUrl}
                        alt="Preview"
                        className={`
                          relative z-10 max-w-full max-h-[500px] object-contain transition-all duration-700
                          ${isProcessing ? 'blur-md scale-105 opacity-50' : 'blur-0 scale-100 opacity-100'}
                        `}
                      />
                      
                      {/* Detected Grid overlay */}
                      {!isProcessing && imgDimensions && (
                        <div
                          className="absolute inset-0 z-20 pointer-events-none transition-all duration-500"
                          style={{
                            display: 'grid',
                            gridTemplateColumns: `repeat(${cols}, 1fr)`,
                            gridTemplateRows: `repeat(${rows}, 1fr)`,
                            opacity: isDetecting ? 0 : 1
                          }}
                        >
                          {Array.from({ length: rows * cols }).map((_, i) => (
                            <div
                              key={i}
                              className="border border-emerald-400/80 shadow-[0_0_10px_rgba(52,211,153,0.3)] box-border relative"
                            >
                              {/* Corner markers for tech feel */}
                              <div className="absolute top-0 left-0 w-2 h-2 border-t-2 border-l-2 border-emerald-400"></div>
                              <div className="absolute top-0 right-0 w-2 h-2 border-t-2 border-r-2 border-emerald-400"></div>
                              <div className="absolute bottom-0 left-0 w-2 h-2 border-b-2 border-l-2 border-emerald-400"></div>
                              <div className="absolute bottom-0 right-0 w-2 h-2 border-b-2 border-r-2 border-emerald-400"></div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {isProcessing && (
                      <div className="absolute inset-0 flex items-center justify-center z-30">
                        <div className="bg-white/95 backdrop-blur-md px-8 py-6 rounded-3xl shadow-2xl flex flex-col items-center gap-4 min-w-[240px] border border-emerald-100">
                          <div className="relative">
                            <div className="absolute inset-0 bg-emerald-200 rounded-full blur-xl opacity-50 animate-pulse"></div>
                            <Wand2 className="text-emerald-500 animate-bounce relative z-10" size={40} />
                          </div>
                          <div className="text-center w-full">
                            <span className="block font-black text-gray-800 tracking-tight text-lg mb-1">Super Sampling...</span>
                            <span className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">AI Upscaling to HD</span>
                            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-500 transition-all duration-300" style={{width: `${processingProgress}%`}}></div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Bottom Info Bar */}
              <div className="mt-6 flex flex-wrap gap-3">
                <div className="flex-1 bg-white p-4 rounded-2xl border border-gray-100 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400">
                    <ImageIcon size={20} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">Original Map</p>
                    <p className="text-sm font-black text-gray-800">
                      {imgDimensions ? `${imgDimensions.w} × ${imgDimensions.h}` : '---'}
                    </p>
                  </div>
                </div>

                <div className="flex-1 bg-white p-4 rounded-2xl border border-emerald-100 flex items-center gap-4 shadow-[0_0_20px_rgba(52,211,153,0.05)]">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-500">
                    <Maximize2 size={20} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600/60 mb-0.5">Upscaled Output</p>
                    <p className="text-sm font-black text-emerald-600">
                      {tiles.length > 0 
                        ? `${tiles[0].newWidth} × ${tiles[0].newHeight}` 
                        : (imgDimensions ? `1080p Target` : '---')}
                    </p>
                  </div>
                </div>
              </div>

            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
