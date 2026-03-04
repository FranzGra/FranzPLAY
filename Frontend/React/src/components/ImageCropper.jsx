import React, { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Cropper from 'react-easy-crop';

import getCroppedImg from '../services/canvasUtils';

export default function ImageCropper({ imageSrc, onCropComplete, onCancel, aspect = 1, cropShape = 'round' }) {
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
    const [loading, setLoading] = useState(false);

    const onCropChange = (crop) => {
        setCrop(crop);
    };

    const onZoomChange = (zoom) => {
        setZoom(zoom);
    };

    const onMediaTypeChange = useCallback((area, areaPixels) => {
        setCroppedAreaPixels(areaPixels);
    }, []);

    const handleSave = async () => {
        setLoading(true);
        try {
            const croppedImageBlob = await getCroppedImg(
                imageSrc,
                croppedAreaPixels
            );
            onCropComplete(croppedImageBlob);
        } catch (e) {
            console.error(e);
            setLoading(false);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden w-full max-w-lg shadow-2xl flex flex-col h-[80vh] md:h-[600px]">

                {/* Header */}
                <div className="p-4 border-b border-zinc-800 bg-zinc-900/50 flex justify-between items-center z-10">
                    <h3 className="text-white font-bold text-lg">Modifica Immagine</h3>
                    <button onClick={onCancel} className="text-zinc-400 hover:text-white transition-colors">
                        Chiudi
                    </button>
                </div>

                {/* Cropper Area */}
                <div className="relative flex-1 bg-black w-full">
                    <Cropper
                        image={imageSrc}
                        crop={crop}
                        zoom={zoom}
                        aspect={aspect}
                        cropShape={cropShape}
                        showGrid={false}
                        onCropChange={onCropChange}
                        onZoomChange={onZoomChange}
                        onCropComplete={onMediaTypeChange}
                    />
                </div>

                {/* Controls */}
                <div className="p-6 bg-zinc-900 border-t border-zinc-800 space-y-6 z-10">
                    {/* Zoom Slider */}
                    <div className="flex items-center gap-4">
                        <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Zoom</span>
                        <input
                            type="range"
                            value={zoom}
                            min={1}
                            max={3}
                            step={0.1}
                            aria-labelledby="Zoom"
                            onChange={(e) => {
                                setZoom(e.target.value)
                            }}
                            className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-[var(--primary-color)]"
                        />
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3">
                        <button
                            onClick={onCancel}
                            className="flex-1 py-3 px-4 rounded-xl font-bold bg-zinc-800 text-white hover:bg-zinc-700 transition-colors"
                        >
                            Annulla
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={loading}
                            className="flex-1 py-3 px-4 rounded-xl font-bold bg-[var(--primary-color)] text-white hover:opacity-90 transition-opacity shadow-lg shadow-[var(--primary-color)]/20 disabled:opacity-50 flex justify-center items-center gap-2"
                        >
                            {loading ? 'Elaborazione...' : 'Salva Immagine'}
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
