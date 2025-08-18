/**
 * libimagequant WASM - Promise-based API for image quantization in browsers
 * 
 * This module provides a high-level, promise-based interface for the libimagequant
 * image quantization library running in a Web Worker with WASM.
 */

export interface QuantizationOptions {
  /** Speed vs quality trade-off (1-10, lower = better quality) */
  speed?: number;
  /** Quality settings */
  quality?: {
    min: number;
    target: number;
  };
  /** Maximum colors in palette (2-256) */
  maxColors?: number;
  /** Dithering level (0.0-1.0) */
  dithering?: number;
  /** Posterization level (0-4) */
  posterization?: number;
  /** Whether to return RGBA image data */
  returnRgba?: boolean;
}

export interface QuantizationResult {
  /** Color palette array */
  palette: number[][];
  /** Palette indices for each pixel (if returnRgba is false) */
  indexedData: number[] | null;
  /** RGBA image data (if returnRgba is true) */
  imageData: number[] | null;
  /** Achieved quality (0-1) */
  quality: number;
  /** Number of colors in palette */
  paletteLength: number;
  /** Image width */
  width: number;
  /** Image height */
  height: number;
}

export interface LibImageQuantOptions {
  /** Custom path to worker.js file */
  workerUrl?: string;
  /** Custom path to WASM module directory (should contain libimagequant_wasm.js) */
  wasmUrl?: string;
  /** Timeout for worker initialization in milliseconds (default: 10000) */
  initTimeout?: number;
  /** Timeout for individual operations in milliseconds (default: 30000) */
  operationTimeout?: number;
}

export class LibImageQuant {
    private worker: Worker | null = null;
    private isReady: boolean = false;
    private pendingOperations = new Map<number, { resolve: (value: any) => void; reject: (reason?: any) => void }>();
    private operationCounter: number = 0;
    private workerUrl: string;
    private wasmUrl?: string;
    private initTimeout: number;
    private operationTimeout: number;
    private initPromise: Promise<void>;

    constructor(options: LibImageQuantOptions = {}) {
        this.workerUrl = options.workerUrl || './worker.js';
        this.wasmUrl = options.wasmUrl;
        this.initTimeout = options.initTimeout || 10000;
        this.operationTimeout = options.operationTimeout || 30000;
        this.initPromise = this.initialize();
    }

    /**
     * Initialize the worker and WASM module
     */
    private async initialize(): Promise<void> {
        if (this.isReady) return;

        return new Promise((resolve, reject) => {
            try {
                this.worker = new Worker(this.workerUrl, { type: 'module' });
                
                this.worker.onmessage = (e) => {
                    const { type, id, success, result, error } = e.data;
                    
                    if (type === 'ready') {
                        // Send WASM URL configuration to worker if provided
                        if (this.wasmUrl) {
                            this.worker?.postMessage({
                                type: 'configure',
                                wasmUrl: this.wasmUrl
                            });
                        }
                        this.isReady = true;
                        resolve();
                        return;
                    }
                    
                    const operation = this.pendingOperations.get(id);
                    if (operation) {
                        this.pendingOperations.delete(id);
                        
                        if (success) {
                            operation.resolve(result);
                        } else {
                            operation.reject(new Error(error));
                        }
                    }
                };
                
                this.worker.onerror = (error) => {
                    reject(new Error(`Worker error: ${error.message}`));
                };
                
                // Set a timeout for initialization
                setTimeout(() => {
                    if (!this.isReady) {
                        reject(new Error('Worker initialization timeout'));
                    }
                }, this.initTimeout);
                
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Send a message to the worker and return a promise
     */
    private async sendMessage(action: string, data: any): Promise<any> {
        await this.initPromise;
        
        return new Promise((resolve, reject) => {
            const id = ++this.operationCounter;
            
            this.pendingOperations.set(id, { resolve, reject });
            
            this.worker?.postMessage({
                id,
                action,
                data
            });
            
            // Set a timeout for the operation
            setTimeout(() => {
                if (this.pendingOperations.has(id)) {
                    this.pendingOperations.delete(id);
                    reject(new Error('Operation timeout'));
                }
            }, this.operationTimeout);
        });
    }

    /**
     * Quantize a single image
     */
    async quantize(
        imageData: ImageData | Uint8ClampedArray, 
        width: number, 
        height: number, 
        options: QuantizationOptions = {}
    ): Promise<QuantizationResult> {
        // Convert ImageData to array if necessary
        const data = imageData instanceof ImageData 
            ? imageData.data 
            : imageData;

        return this.sendMessage('quantize', {
            imageData: Array.from(data),
            width,
            height,
            options
        });
    }

    /**
     * Quantize using ImageData object directly
     */
    async quantizeImageData(imageData: ImageData, options: QuantizationOptions = {}): Promise<QuantizationResult> {
        return this.quantize(imageData.data, imageData.width, imageData.height, options);
    }

    /**
     * Quantize an image from a canvas element
     */
    async quantizeCanvas(canvas: HTMLCanvasElement, options: QuantizationOptions = {}): Promise<QuantizationResult> {
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Failed to get 2D context');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return this.quantizeImageData(imageData, options);
    }

    /**
     * Quantize an image from an Image or HTMLImageElement
     */
    async quantizeImage(image: HTMLImageElement, options: QuantizationOptions = {}): Promise<QuantizationResult> {
        return new Promise((resolve, reject) => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Failed to get 2D context');
            
            canvas.width = image.naturalWidth || image.width;
            canvas.height = image.naturalHeight || image.height;
            
            ctx.drawImage(image, 0, 0);
            
            this.quantizeCanvas(canvas, options)
                .then(resolve)
                .catch(reject);
        });
    }

    /**
     * Create a histogram from multiple images (for batch quantization)
     */
    async createHistogram(
        images: Array<{ imageData: ImageData | Uint8ClampedArray; width: number; height: number }>, 
        options: QuantizationOptions = {}
    ): Promise<{ histogramId: string; imageCount: number }> {
        const processedImages = images.map(img => ({
            imageData: Array.from(img.imageData instanceof ImageData ? img.imageData.data : img.imageData),
            width: img.width,
            height: img.height
        }));

        return this.sendMessage('create_histogram', {
            images: processedImages,
            options
        });
    }

    /**
     * Apply quantization result to a canvas
     */
    applyToCanvas(canvas: HTMLCanvasElement, result: QuantizationResult): void {
        if (!result.imageData) {
            throw new Error('Result does not contain image data');
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Failed to get 2D context');
        canvas.width = result.width;
        canvas.height = result.height;

        const imageData = new ImageData(
            new Uint8ClampedArray(result.imageData),
            result.width,
            result.height
        );

        ctx.putImageData(imageData, 0, 0);
    }

    /**
     * Create an ImageData object from quantization result
     */
    toImageData(result: QuantizationResult): ImageData {
        if (!result.imageData) {
            throw new Error('Result does not contain image data');
        }

        return new ImageData(
            new Uint8ClampedArray(result.imageData),
            result.width,
            result.height
        );
    }

    /**
     * Terminate the worker and clean up resources
     */
    dispose() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        
        this.isReady = false;
        this.pendingOperations.clear();
    }
}

// Convenience functions
export function createQuantizer(options?: LibImageQuantOptions): LibImageQuant {
    return new LibImageQuant(options);
}

export async function quantizeImageData(imageData: ImageData, options: QuantizationOptions = {}): Promise<QuantizationResult> {
    const quantizer = new LibImageQuant();
    try {
        return await quantizer.quantizeImageData(imageData, options);
    } finally {
        quantizer.dispose();
    }
}

export async function quantizeCanvas(canvas: HTMLCanvasElement, options: QuantizationOptions = {}): Promise<QuantizationResult> {
    const quantizer = new LibImageQuant();
    try {
        return await quantizer.quantizeCanvas(canvas, options);
    } finally {
        quantizer.dispose();
    }
}

export async function quantizeImage(image: HTMLImageElement, options: QuantizationOptions = {}): Promise<QuantizationResult> {
    const quantizer = new LibImageQuant();
    try {
        return await quantizer.quantizeImage(image, options);
    } finally {
        quantizer.dispose();
    }
}

// Default export
export default LibImageQuant;