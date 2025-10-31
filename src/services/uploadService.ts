interface UploadResponse {
  status: 'success' | 'skipped' | 'error';
  reason?: string;
  fileId?: string;
  message?: string;
}

interface DatabaseClient {
  collection: (name: string) => {
    findOne: (query: any) => Promise<any>;
    insertOne: (document: any) => Promise<any>;
    updateOne: (query: any, update: any) => Promise<any>;
  };
}

// Mock database client - replace with actual MongoDB client
const db: DatabaseClient = {
  collection: (name: string) => ({
    findOne: async (query: any) => {
      // Mock implementation - replace with actual MongoDB query
      console.log(`Finding one in ${name} with query:`, query);
      return null; // Simulate no existing record
    },
    insertOne: async (document: any) => {
      // Mock implementation - replace with actual MongoDB insert
      console.log(`Inserting into ${name}:`, document);
      return { insertedId: 'mock-id-' + Date.now() };
    },
    updateOne: async (query: any, update: any) => {
      // Mock implementation - replace with actual MongoDB update
      console.log(`Updating ${name} with query:`, query, 'update:', update);
      return { modifiedCount: 1 };
    }
  })
};

async function checkForDuplicate(filename: string, userId: string): Promise<boolean> {
  try {
    const existing = await db.collection('uploads').findOne({
      filename,
      userId,
      status: { $in: ['completed', 'processing'] }
    });
    return !!existing;
  } catch (error) {
    console.error('Error checking for duplicate:', error);
    return false; // Assume no duplicate on error
  }
}

function validateFilename(filename: string): { valid: boolean; error?: string } {
  // Check for valid filename patterns
  const invalidPatterns = [
    /[<>:"|?*]/, // Invalid Windows characters
    /^\./, // Hidden files
    /\.exe$/i, // Executable files
    /\.bat$/i, // Batch files
    /\.cmd$/i, // Command files
  ];

  // Check file extension
  const allowedExtensions = ['.csv', '.json', '.txt', '.log', '.xml'];
  const fileExtension = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  
  if (!allowedExtensions.includes(fileExtension)) {
    return {
      valid: false,
      error: `File type ${fileExtension} is not allowed. Allowed types: ${allowedExtensions.join(', ')}`
    };
  }

  // Check for invalid patterns
  for (const pattern of invalidPatterns) {
    if (pattern.test(filename)) {
      return {
        valid: false,
        error: 'Filename contains invalid characters'
      };
    }
  }

  // Check file length
  if (filename.length > 255) {
    return {
      valid: false,
      error: 'Filename is too long (max 255 characters)'
    };
  }

  return { valid: true };
}

async function processFile(file: File, userId: string): Promise<string> {
  // Simulate file processing
  const processingSteps = [
    { stage: 'uploaded', progress: 25 },
    { stage: 'validating', progress: 50 },
    { stage: 'parsing', progress: 75 },
    { stage: 'completed', progress: 100 }
  ];

  const fileId = 'file-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

  for (const step of processingSteps) {
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate processing time
    console.log(`File ${fileId} - Stage: ${step.stage}, Progress: ${step.progress}%`);
  }

  return fileId;
}

export async function uploadFile(file: File, userId: string): Promise<UploadResponse> {
  try {
    // Validate filename
    const filenameValidation = validateFilename(file.name);
    if (!filenameValidation.valid) {
      return {
        status: 'error',
        reason: filenameValidation.error
      };
    }

    // Check for duplicates
    if (await checkForDuplicate(file.name, userId)) {
      return {
        status: 'skipped',
        reason: 'duplicate'
      };
    }

    // Insert upload record in processing state
    await db.collection('uploads').insertOne({
      filename: file.name,
      userId,
      status: 'processing',
      createdAt: new Date(),
      fileSize: file.size
    });

    // Process the file
    const fileId = await processFile(file, userId);

    // Update record to completed
    await db.collection('uploads').updateOne(
      { filename: file.name, userId },
      { 
        $set: { 
          status: 'completed',
          fileId,
          completedAt: new Date()
        }
      }
    );

    return {
      status: 'success',
      fileId,
      message: `File ${file.name} uploaded and processed successfully`
    };

  } catch (error) {
    console.error('Upload error:', error);
    
    // Update record to failed if it exists
    await db.collection('uploads').updateOne(
      { filename: file.name, userId },
      { 
        $set: { 
          status: 'failed',
          error: error.message,
          failedAt: new Date()
        }
      }
    );

    return {
      status: 'error',
      reason: error.message || 'Unknown upload error'
    };
  }
}

export async function getUploadHistory(userId: string): Promise<any[]> {
  try {
    const uploads = await db.collection('uploads').findOne({
      userId,
      // Mock query - in real implementation this would be find() with toArray()
    });
    
    return uploads || []; // Return empty array if no uploads found
  } catch (error) {
    console.error('Error getting upload history:', error);
    return [];
  }
}

export async function deleteUpload(filename: string, userId: string): Promise<boolean> {
  try {
    // Update status to deleted instead of actually deleting
    const result = await db.collection('uploads').updateOne(
      { filename, userId },
      { 
        $set: { 
          status: 'deleted',
          deletedAt: new Date()
        }
      }
    );
    
    return result.modifiedCount > 0;
  } catch (error) {
    console.error('Error deleting upload:', error);
    return false;
  }
}