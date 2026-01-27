/**
 * ZIP Extractor - Extracts images from ZIP files
 * Supports nested directories and filters for image files only
 */

const fs = require('fs');
const path = require('path');
const { createReadStream } = require('fs');

// We'll use the built-in zlib for basic operations
// and implement a simple ZIP parser for local use
const zlib = require('zlib');

/**
 * Simple ZIP file reader using Node.js built-in modules
 * For production, consider using 'adm-zip' or 'unzipper' packages
 */
class ZipReader {
  constructor(buffer) {
    this.buffer = buffer;
    this.entries = [];
    this.parse();
  }

  parse() {
    // Find End of Central Directory record
    let eocdOffset = -1;
    for (let i = this.buffer.length - 22; i >= 0; i--) {
      if (this.buffer.readUInt32LE(i) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }

    if (eocdOffset === -1) {
      throw new Error('Invalid ZIP file: EOCD not found');
    }

    // Read EOCD
    const cdOffset = this.buffer.readUInt32LE(eocdOffset + 16);
    const cdSize = this.buffer.readUInt32LE(eocdOffset + 12);
    const totalEntries = this.buffer.readUInt16LE(eocdOffset + 10);

    // Read Central Directory entries
    let offset = cdOffset;
    for (let i = 0; i < totalEntries; i++) {
      if (this.buffer.readUInt32LE(offset) !== 0x02014b50) {
        break;
      }

      const compressionMethod = this.buffer.readUInt16LE(offset + 10);
      const compressedSize = this.buffer.readUInt32LE(offset + 20);
      const uncompressedSize = this.buffer.readUInt32LE(offset + 24);
      const fileNameLength = this.buffer.readUInt16LE(offset + 28);
      const extraFieldLength = this.buffer.readUInt16LE(offset + 30);
      const commentLength = this.buffer.readUInt16LE(offset + 32);
      const localHeaderOffset = this.buffer.readUInt32LE(offset + 42);

      const fileName = this.buffer.toString('utf8', offset + 46, offset + 46 + fileNameLength);

      this.entries.push({
        fileName,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset
      });

      offset += 46 + fileNameLength + extraFieldLength + commentLength;
    }
  }

  getEntry(entry) {
    const localOffset = entry.localHeaderOffset;

    // Verify local file header signature
    if (this.buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error('Invalid local file header');
    }

    const fileNameLength = this.buffer.readUInt16LE(localOffset + 26);
    const extraFieldLength = this.buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + fileNameLength + extraFieldLength;

    const compressedData = this.buffer.slice(dataOffset, dataOffset + entry.compressedSize);

    if (entry.compressionMethod === 0) {
      // Stored (no compression)
      return compressedData;
    } else if (entry.compressionMethod === 8) {
      // Deflate
      return zlib.inflateRawSync(compressedData);
    } else {
      throw new Error(`Unsupported compression method: ${entry.compressionMethod}`);
    }
  }
}

// Image file extensions we support
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];

/**
 * Check if a filename is an image
 */
function isImageFile(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

/**
 * Get MIME type from filename
 */
function getMimeType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const mimeTypes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Extract images from a ZIP buffer
 * @param {Buffer} zipBuffer - The ZIP file as a buffer
 * @returns {Array<{fileName: string, buffer: Buffer, mimeType: string}>} Extracted images
 */
function extractImagesFromZip(zipBuffer) {
  const zip = new ZipReader(zipBuffer);
  const images = [];

  for (const entry of zip.entries) {
    // Skip directories
    if (entry.fileName.endsWith('/')) {
      continue;
    }

    // Skip hidden files (macOS __MACOSX, etc.)
    if (entry.fileName.startsWith('__MACOSX/') ||
        entry.fileName.includes('/.') ||
        path.basename(entry.fileName).startsWith('.')) {
      continue;
    }

    // Only process image files
    if (!isImageFile(entry.fileName)) {
      continue;
    }

    try {
      const buffer = zip.getEntry(entry);
      images.push({
        fileName: path.basename(entry.fileName),
        fullPath: entry.fileName,
        buffer: buffer,
        mimeType: getMimeType(entry.fileName)
      });
    } catch (error) {
      console.warn(`Failed to extract ${entry.fileName}: ${error.message}`);
    }
  }

  return images;
}

/**
 * Check if a buffer is a ZIP file
 */
function isZipFile(buffer) {
  // ZIP files start with PK (0x50, 0x4B)
  return buffer.length >= 4 &&
         buffer[0] === 0x50 &&
         buffer[1] === 0x4B &&
         (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07);
}

module.exports = {
  extractImagesFromZip,
  isZipFile,
  isImageFile,
  getMimeType,
  IMAGE_EXTENSIONS
};
