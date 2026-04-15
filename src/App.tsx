import React, { useState, useRef, useCallback } from 'react';
import { Upload, Download, Image as ImageIcon, X, Grid3X3, Check, Loader2, Scissors } from 'lucide-react';

interface TileData {
  row: number;
  col: number;
  blobUrl: string;
}

export default function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rows, setRows] = useState(2);
  const [cols, setCols] = useState(2);
  const [isProcessing, setIsProcessing] = useState(false);
  const [tiles, setTiles] = useState<TileData[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [imgDimensions, setImgDimensions] = useState<{ w: number; h: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    if (file && file.type.startsWith('image/')) {
      setSelectedFile(file);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      tiles.forEach(t => URL.revokeObjectURL(t.blobUrl));

      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      setTiles([]);
      setImgDimensions(null);

      // 读取图片尺寸
      const img = new Image();
      img.onload = () => setImgDimensions({ w: img.width, h: img.height });
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

  const splitImage = useCallback(async () => {
    if (!previewUrl) return;

    setIsProcessing(true);
    // 清除旧 tiles
    tiles.forEach(t => URL.revokeObjectURL(t.blobUrl));
    setTiles([]);

    const img = new Image();
    img.src = previewUrl;

    img.onload = async () => {
      const tileWidth = Math.floor(img.width / cols);
      const tileHeight = Math.floor(img.height / rows);
      const newTiles: TileData[] = [];

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const canvas = document.createElement('canvas');
          canvas.width = tileWidth;
          canvas.height = tileHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;

          ctx.drawImage(
            img,
            col * tileWidth, row * tileHeight,
            tileWidth, tileHeight,
            0, 0,
            tileWidth, tileHeight
          );

          const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, 'image/png')
          );

          if (blob) {
            newTiles.push({
              row,
              col,
              blobUrl: URL.createObjectURL(blob),
            });
          }
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
    link.download = `${fileName}_r${tile.row + 1}_c${tile.col + 1}.png`;
    link.href = tile.blobUrl;
    link.click();
  };

  const downloadAllTiles = () => {
    tiles.forEach((tile, i) => {
      setTimeout(() => downloadTile(tile), i * 200);
    });
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5] text-[#1A1A1A] font-sans selection:bg-emerald-100">
      {/* Header */}
      <header className="max-w-7xl mx-auto px-6 py-8 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-emerald-200">
            <Grid3X3 size={24} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">PixelBoost</h1>
        </div>
        <div className="text-sm text-gray-500 font-medium hidden sm:block">
          Image Grid Splitter
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
                    <p className="text-xs text-gray-400">
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                      {imgDimensions && ` • ${imgDimensions.w} × ${imgDimensions.h} px`}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-4 text-gray-400">
                      <Upload size={24} />
                    </div>
                    <p className="text-sm font-medium text-gray-600">Click or drag image to upload</p>
                    <p className="text-xs text-gray-400 mt-2">Supports JPG, PNG, WEBP</p>
                  </>
                )}
              </div>
            </section>

            <section className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-6 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center text-[10px] text-gray-500">2</span>
                Split Settings
              </h2>

              <div className="space-y-6">
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-3">Grid Layout</label>
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <label className="text-xs text-gray-400 block mb-1.5">Rows</label>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={rows}
                        onChange={(e) => { setRows(Math.max(1, Math.min(20, parseInt(e.target.value) || 1))); setTiles([]); }}
                        className="w-full py-3 px-4 rounded-xl font-bold text-center bg-gray-100 text-gray-700 border-2 border-transparent focus:border-emerald-500 focus:bg-white outline-none transition-all"
                      />
                    </div>
                    <span className="text-gray-400 font-bold text-lg mt-5">×</span>
                    <div className="flex-1">
                      <label className="text-xs text-gray-400 block mb-1.5">Cols</label>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={cols}
                        onChange={(e) => { setCols(Math.max(1, Math.min(20, parseInt(e.target.value) || 1))); setTiles([]); }}
                        className="w-full py-3 px-4 rounded-xl font-bold text-center bg-gray-100 text-gray-700 border-2 border-transparent focus:border-emerald-500 focus:bg-white outline-none transition-all"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mt-3">
                    Output: {rows * cols} tiles
                    {imgDimensions && ` • Each ~${Math.floor(imgDimensions.w / cols)} × ${Math.floor(imgDimensions.h / rows)} px`}
                  </p>
                </div>

                <button
                  disabled={!selectedFile || isProcessing}
                  onClick={splitImage}
                  className={`
                    w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all
                    ${!selectedFile || isProcessing
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-[#1A1A1A] text-white hover:bg-gray-800 shadow-xl shadow-gray-200 active:scale-[0.98]'}
                  `}
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="animate-spin" size={20} />
                      Splitting...
                    </>
                  ) : (
                    <>
                      <Scissors size={20} />
                      Split Image
                    </>
                  )}
                </button>
              </div>
            </section>

            {tiles.length > 0 && (
              <section className="bg-emerald-500 rounded-3xl p-6 shadow-lg shadow-emerald-200 text-white">
                <h2 className="text-sm font-semibold uppercase tracking-wider opacity-80 mb-4">3. Download Tiles</h2>
                <button
                  onClick={downloadAllTiles}
                  className="w-full bg-white text-emerald-600 py-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-emerald-50 transition-colors active:scale-[0.98]"
                >
                  <Download size={20} />
                  Download All {tiles.length} Tiles
                </button>
              </section>
            )}
          </div>

          {/* Right Column: Preview */}
          <div className="lg:col-span-8">
            <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-gray-100 h-full flex flex-col min-h-[600px]">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-xl font-bold">Preview</h2>
                {tiles.length > 0 && (
                  <div className="flex items-center gap-2 text-emerald-500 bg-emerald-50 px-3 py-1 rounded-full text-sm font-medium">
                    <Check size={16} />
                    Split Complete • {tiles.length} tiles
                  </div>
                )}
              </div>

              {/* Original image with grid overlay or tiles */}
              <div className="flex-1 relative bg-gray-50 rounded-2xl overflow-hidden border border-gray-100 flex items-center justify-center">
                {!previewUrl ? (
                  <div className="text-center space-y-4">
                    <div className="w-20 h-20 bg-white rounded-3xl shadow-sm flex items-center justify-center mx-auto text-gray-200">
                      <ImageIcon size={40} />
                    </div>
                    <p className="text-gray-400 font-medium">No image selected</p>
                  </div>
                ) : tiles.length > 0 ? (
                  /* Tile grid preview */
                  <div
                    className="grid gap-2 p-4 w-full h-full"
                    style={{
                      gridTemplateColumns: `repeat(${cols}, 1fr)`,
                      gridTemplateRows: `repeat(${rows}, 1fr)`,
                    }}
                  >
                    {tiles.map((tile) => (
                      <div
                        key={`${tile.row}-${tile.col}`}
                        className="relative group rounded-lg overflow-hidden border border-gray-200 bg-white cursor-pointer hover:shadow-lg transition-all"
                        onClick={() => downloadTile(tile)}
                      >
                        <img
                          src={tile.blobUrl}
                          alt={`Tile ${tile.row + 1}-${tile.col + 1}`}
                          className="w-full h-full object-contain"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center">
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center gap-1">
                            <Download size={20} className="text-white" />
                            <span className="text-white text-xs font-bold">R{tile.row + 1} C{tile.col + 1}</span>
                          </div>
                        </div>
                        <div className="absolute top-1 left-1 bg-black/60 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                          {tile.row + 1},{tile.col + 1}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  /* Original image with grid overlay */
                  <div className="relative w-full h-full p-8 flex items-center justify-center">
                    <div className="relative inline-block">
                      <img
                        src={previewUrl}
                        alt="Preview"
                        className={`
                          max-w-full max-h-[500px] object-contain rounded-lg shadow-2xl transition-all duration-500
                          ${isProcessing ? 'blur-sm opacity-50' : 'blur-0 opacity-100'}
                        `}
                      />
                      {/* Grid overlay */}
                      <div
                        className="absolute inset-0 pointer-events-none"
                        style={{
                          display: 'grid',
                          gridTemplateColumns: `repeat(${cols}, 1fr)`,
                          gridTemplateRows: `repeat(${rows}, 1fr)`,
                        }}
                      >
                        {Array.from({ length: rows * cols }).map((_, i) => (
                          <div
                            key={i}
                            className="border border-emerald-400/50 border-dashed"
                          />
                        ))}
                      </div>
                    </div>

                    {isProcessing && (
                      <div className="absolute inset-0 flex items-center justify-center z-10">
                        <div className="bg-white/90 backdrop-blur-sm px-6 py-4 rounded-2xl shadow-xl flex items-center gap-4">
                          <Loader2 className="animate-spin text-emerald-500" size={24} />
                          <div className="text-left">
                            <span className="block font-bold text-gray-800 tracking-tight">Splitting Image...</span>
                            <span className="block text-[10px] text-gray-400 uppercase tracking-widest">Creating {rows * cols} tiles</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-8 grid grid-cols-3 gap-4">
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Original Size</p>
                  <p className="text-lg font-bold">
                    {imgDimensions ? `${imgDimensions.w} × ${imgDimensions.h}` : '--'}
                  </p>
                </div>
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Grid Layout</p>
                  <p className="text-lg font-bold text-emerald-500">{rows} × {cols}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Tile Size</p>
                  <p className="text-lg font-bold">
                    {imgDimensions
                      ? `${Math.floor(imgDimensions.w / cols)} × ${Math.floor(imgDimensions.h / rows)}`
                      : '--'}
                  </p>
                </div>
              </div>
            </div>
          </div>

        </div>
      </main>

      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-gray-200 flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="flex items-center gap-2 opacity-40 grayscale">
          <div className="w-6 h-6 bg-black rounded flex items-center justify-center text-white">
            <Grid3X3 size={14} />
          </div>
          <span className="text-sm font-bold tracking-tighter">PIXELBOOST</span>
        </div>
        <p className="text-sm text-gray-400">© 2026 PixelBoost. All rights reserved.</p>
        <div className="flex gap-6 text-sm font-medium text-gray-400">
          <a href="#" className="hover:text-emerald-500 transition-colors">Privacy</a>
          <a href="#" className="hover:text-emerald-500 transition-colors">Terms</a>
          <a href="#" className="hover:text-emerald-500 transition-colors">Support</a>
        </div>
      </footer>
    </div>
  );
}
