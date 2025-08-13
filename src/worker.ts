// Web Worker for libimagequant WASM module
// Import will be done dynamically at runtime

interface WorkerMessage {
    id: number;
    action: string;
    data: any;
}

interface ConfigureMessage {
    type: 'configure';
    wasmUrl: string;
}

interface QuantizationData {
    imageData: number[];
    width: number;
    height: number;
    options?: {
        speed?: number;
        quality?: { min: number; target: number };
        maxColors?: number;
        posterization?: number;
        dithering?: number;
        returnRgba?: boolean;
    };
}

interface HistogramData {
    images: Array<{ imageData: number[]; width: number; height: number }>;
    options?: any;
}

let isInitialized: boolean = false;
let wasmModule: any = null;
let customWasmUrl: string | null = null;

// Initialize WASM module
async function initializeWasm(): Promise<boolean> {
    if (!isInitialized) {
        // Use custom WASM URL if provided, otherwise use default relative path
        const wasmPath = customWasmUrl 
            ? new URL('libimagequant_wasm.js', customWasmUrl).href
            : new URL('./wasm/libimagequant_wasm.js', import.meta.url).href;
        
        wasmModule = await import(wasmPath);
        await wasmModule.default(); // Initialize the WASM module
        isInitialized = true;
    }
    return true;
}

// Message handler for worker
self.onmessage = async function(e: MessageEvent<WorkerMessage | ConfigureMessage>) {
    const message = e.data;
    
    // Handle configuration message
    if ('type' in message && message.type === 'configure') {
        customWasmUrl = message.wasmUrl;
        return;
    }
    
    // Handle regular operation messages  
    const { id, action, data } = message as WorkerMessage;
    
    try {
        // Ensure WASM is initialized
        await initializeWasm();
        
        let result;
        
        switch (action) {
            case 'quantize':
                result = await quantizeImage(data);
                break;
            case 'create_histogram':
                result = await createHistogram(data);
                break;
            default:
                throw new Error(`Unknown action: ${action}`);
        }
        
        // Send success response
        self.postMessage({
            id,
            success: true,
            result
        });
        
    } catch (error) {
        // Send error response
        self.postMessage({
            id,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        });
    }
};

async function quantizeImage(data: QuantizationData) {
    const {
        imageData,
        width,
        height,
        options = {}
    } = data;
    
    // Create quantizer instance
    const quantizer = new wasmModule.ImageQuantizer();
    
    // Apply options
    if (options.speed !== undefined) {
        quantizer.setSpeed(options.speed);
    }
    
    if (options.quality !== undefined) {
        const { min = 0, target = 100 } = options.quality;
        quantizer.setQuality(min, target);
    }
    
    if (options.maxColors !== undefined) {
        quantizer.setMaxColors(options.maxColors);
    }
    
    if (options.posterization !== undefined) {
        quantizer.setPosterization(options.posterization);
    }
    
    // Convert ImageData to Uint8ClampedArray if necessary
    const rgbaData = imageData instanceof Uint8ClampedArray 
        ? imageData 
        : new Uint8ClampedArray(imageData);
    
    // Quantize the image
    const quantResult = quantizer.quantizeImage(rgbaData, width, height);
    
    // Extract results
    const palette = quantResult.getPalette();
    const quality = quantResult.getQuantizationQuality();
    const paletteLength = quantResult.getPaletteLength();
    
    // Set dithering if specified
    if (options.dithering !== undefined) {
        quantResult.setDithering(options.dithering);
    }
    
    // Remap image to get final RGBA data
    let finalImageData = null;
    if (options.returnRgba !== false) {
        const remappedRgbaData = quantResult.remapImage(rgbaData, width, height);
        finalImageData = remappedRgbaData;
    }
    
    return {
        palette: Array.from(palette).map(color => Array.from(color as ArrayLike<number>)),
        indexedData: null, // We no longer return indexed data separately
        imageData: finalImageData ? Array.from(finalImageData as ArrayLike<number>) : null,
        quality,
        paletteLength,
        width,
        height
    };
}


async function createHistogram(data: HistogramData) {
    const {
        images,
        options = {}
    } = data;
    
    // Create quantizer for histogram attributes
    const quantizer = new wasmModule.ImageQuantizer();
    
    // Apply options to quantizer
    if (options.speed !== undefined) {
        quantizer.setSpeed(options.speed);
    }
    
    if (options.quality !== undefined) {
        const { min = 0, target = 100 } = options.quality;
        quantizer.setQuality(min, target);
    }
    
    if (options.maxColors !== undefined) {
        quantizer.setMaxColors(options.maxColors);
    }
    
    // Create histogram
    const histogram = new wasmModule.ImageHistogram(quantizer);
    
    // Add images to histogram
    for (const imageInfo of images) {
        const { imageData, width, height } = imageInfo;
        const rgbaData = imageData instanceof Uint8ClampedArray 
            ? imageData 
            : new Uint8ClampedArray(imageData);
            
        histogram.addImage(rgbaData, width, height);
    }
    
    // Note: We'd need to store the histogram and return an ID
    // For now, return a placeholder
    return {
        histogramId: 'placeholder_' + Date.now(),
        imageCount: images.length
    };
}

// Send ready message when worker is loaded
self.postMessage({ type: 'ready' });