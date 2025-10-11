document.addEventListener('DOMContentLoaded', () => {
    const systemsList = document.getElementById('systems-list');
    const newSystemNameInput = document.getElementById('new-system-name');
    const addSystemBtn = document.getElementById('add-system-btn');
    const bulkFileInput = document.getElementById('bulk-file-input');
    const selectedFilesContainer = document.getElementById('selected-files-container');
    const selectedFilesList = document.getElementById('selected-files-list');
    const bulkAnalyzeBtn = document.getElementById('bulk-analyze-btn');
    const loadingOverlay = document.getElementById('loading-overlay');
    const errorContainer = document.getElementById('error-container');
    const errorMessage = document.getElementById('error-message');

    // --- Batch Progress Elements ---
    const batchProgressContainer = document.getElementById('batch-progress-container');
    const batchStatusEl = document.getElementById('batch-status');
    const batchProgressText = document.getElementById('batch-progress-text');
    const batchProgressBar = document.getElementById('batch-progress-bar');
    const batchCompletedCount = document.getElementById('batch-completed-count');
    const batchFailedCount = document.getElementById('batch-failed-count');
    
    let systems = [];
    let poller = null; // To hold the setInterval ID

    const showLoading = (show) => loadingOverlay.classList.toggle('hidden', !show);
    const showError = (message) => {
        errorMessage.textContent = message;
        errorContainer.classList.remove('hidden');
    };
    const clearError = () => errorContainer.classList.add('hidden');

    const renderSystems = () => {
        systemsList.innerHTML = '';
        if (!systems || systems.length === 0) {
            systemsList.innerHTML = '<p class="text-gray-500">No systems found.</p>';
            return;
        }
        systems.forEach(system => {
            const li = document.createElement('li');
            li.className = 'flex justify-between items-center p-2 bg-gray-50 rounded';
            li.innerHTML = `
                <span>${system.name}</span>
                <button data-id="${system.id}" class="delete-system-btn text-red-500 hover:text-red-700">
                    <i class="fas fa-trash"></i>
                </button>
            `;
            systemsList.appendChild(li);
        });
    };

    const fetchSystems = async () => {
        try {
            showLoading(true);
            const response = await fetch('/.netlify/functions/systems');
            if (!response.ok) throw new Error('Failed to fetch systems');
            systems = await response.json();
            renderSystems();
        } catch (e) {
            showError(e.message);
        } finally {
            showLoading(false);
        }
    };
    
    // Polling function to get batch status
    const pollBatchStatus = (batchId) => {
        if (poller) clearInterval(poller);

        poller = setInterval(async () => {
            try {
                const response = await fetch(`/.netlify/functions/job-status?batchId=${batchId}`);
                if (!response.ok) {
                    // Stop polling on 404 or other fatal errors
                    throw new Error(`Failed to fetch status update (status: ${response.status}).`);
                }
                
                const data = await response.json();
                
                // Update UI elements
                batchStatusEl.textContent = data.status;
                const processedCount = data.completedJobs + data.failedJobs;
                batchProgressText.textContent = `${processedCount} / ${data.totalJobs} files processed`;
                batchCompletedCount.textContent = `Successful: ${data.completedJobs}`;
                batchFailedCount.textContent = `Failed: ${data.failedJobs}`;
                
                const percentage = data.totalJobs > 0 ? (processedCount / data.totalJobs) * 100 : 0;
                batchProgressBar.style.width = `${percentage}%`;

                if (data.status === 'completed') {
                    clearInterval(poller);
                    bulkAnalyzeBtn.disabled = false;
                    bulkAnalyzeBtn.textContent = `Analyze Files`;
                    alert(`Batch processing complete! ${data.completedJobs} successful, ${data.failedJobs} failed.`);
                    setTimeout(() => {
                        batchProgressContainer.classList.add('hidden');
                        bulkFileInput.value = ''; // Clear file input
                        selectedFilesContainer.classList.add('hidden');
                    }, 5000);
                }
            } catch (err) {
                showError(err.message);
                clearInterval(poller);
                bulkAnalyzeBtn.disabled = false;
                bulkAnalyzeBtn.textContent = `Analyze Files`;
            }
        }, 3000); // Poll every 3 seconds
    };

    addSystemBtn.addEventListener('click', async () => {
        const name = newSystemNameInput.value.trim();
        if (!name) return;
        try {
            showLoading(true);
            const response = await fetch('/.netlify/functions/systems', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            if (!response.ok) throw new Error('Failed to add system');
            newSystemNameInput.value = '';
            await fetchSystems();
        } catch (e) {
            showError(e.message);
        } finally {
            showLoading(false);
        }
    });

    systemsList.addEventListener('click', async (e) => {
        const deleteBtn = e.target.closest('.delete-system-btn');
        if (deleteBtn) {
            const id = deleteBtn.dataset.id;
            if (confirm('Are you sure you want to delete this system?')) {
                try {
                    showLoading(true);
                    const response = await fetch(`/.netlify/functions/systems?id=${id}`, {
                        method: 'DELETE'
                    });
                    if (!response.ok) throw new Error('Failed to delete system');
                    await fetchSystems();
                } catch (err) {
                    showError(err.message);
                } finally {
                    showLoading(false);
                }
            }
        }
    });
    
    bulkFileInput.addEventListener('change', () => {
        selectedFilesList.innerHTML = '';
        if (bulkFileInput.files.length > 0) {
            selectedFilesContainer.classList.remove('hidden');
            Array.from(bulkFileInput.files).forEach(file => {
                const li = document.createElement('li');
                li.textContent = file.name;
                selectedFilesList.appendChild(li);
            });
        } else {
            selectedFilesContainer.classList.add('hidden');
        }
    });

    bulkAnalyzeBtn.addEventListener('click', async () => {
        if (bulkFileInput.files.length === 0) return;

        clearError();
        bulkAnalyzeBtn.disabled = true;
        bulkAnalyzeBtn.textContent = 'Processing...';
        
        // Reset and show progress container
        batchProgressContainer.classList.remove('hidden');
        batchStatusEl.textContent = 'Initializing...';
        batchProgressBar.style.width = '0%';
        batchProgressText.textContent = `0 / ${bulkFileInput.files.length} files processed`;
        batchCompletedCount.textContent = `Successful: 0`;
        batchFailedCount.textContent = `Failed: 0`;

        try {
            const imagePromises = Array.from(bulkFileInput.files).map(file => {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve({ name: file.name, data: reader.result });
                    reader.onerror = error => reject(error);
                    reader.readAsDataURL(file);
                });
            });

            const images = await Promise.all(imagePromises);
            const payload = { images, systems };

            const response = await fetch('/.netlify/functions/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (!response.ok || response.status !== 202) {
                throw new Error(result.error || 'Failed to start bulk analysis.');
            }
            
            if (result.batchId) {
                // Start polling for status
                pollBatchStatus(result.batchId);
            } else {
                 throw new Error("Server did not return a batchId.");
            }

        } catch (err) {
            showError(err.message);
            bulkAnalyzeBtn.disabled = false;
            bulkAnalyzeBtn.textContent = `Analyze Files`;
            batchProgressContainer.classList.add('hidden');
        }
    });

    fetchSystems();
});