// Global variables
let currentVideoData = null;
let downloadInterval = null;

// DOM elements
const urlForm = document.getElementById('urlForm');
const videoUrlInput = document.getElementById('videoUrl');
const fetchBtn = document.getElementById('fetchBtn');
const loadingState = document.getElementById('loadingState');
const videoInfo = document.getElementById('videoInfo');
const downloadProgress = document.getElementById('downloadProgress');
const errorState = document.getElementById('errorState');
const errorMessage = document.getElementById('errorMessage');
const tryAgainBtn = document.getElementById('tryAgainBtn');

// Utility functions
function showElement(element) {
    element.classList.remove('hidden');
}

function hideElement(element) {
    element.classList.add('hidden');
}

function hideAllStates() {
    hideElement(loadingState);
    hideElement(videoInfo);
    hideElement(downloadProgress);
    hideElement(errorState);
}

function showError(message) {
    hideAllStates();
    errorMessage.textContent = message;
    showElement(errorState);
}

function formatDuration(seconds) {
    if (!seconds) return 'Unknown';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
}

function formatViews(views) {
    if (!views) return 'Unknown';
    
    if (views >= 1000000) {
        return `${(views / 1000000).toFixed(1)}M views`;
    } else if (views >= 1000) {
        return `${(views / 1000).toFixed(1)}K views`;
    } else {
        return `${views} views`;
    }
}

function isValidYouTubeUrl(url) {
    const patterns = [
        /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|embed\/|v\/)|youtu\.be\/)[\w-]+/,
        /^(https?:\/\/)?(www\.)?youtube\.com\/shorts\/[\w-]+/,
        /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=[\w-]+/,
        /^(https?:\/\/)?(www\.)?youtu\.be\/[\w-]+/
    ];
    return patterns.some(pattern => pattern.test(url));
}

// Event listeners
urlForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const url = videoUrlInput.value.trim();
    
    if (!url) {
        showError('Please enter a YouTube URL');
        return;
    }
    
    if (!isValidYouTubeUrl(url)) {
        showError('Please enter a valid YouTube URL');
        return;
    }
    
    await fetchVideoInfo(url);
});

tryAgainBtn.addEventListener('click', () => {
    hideAllStates();
    videoUrlInput.focus();
});

// Main functions
async function fetchVideoInfo(url) {
    try {
        hideAllStates();
        showElement(loadingState);
        
        fetchBtn.disabled = true;
        fetchBtn.innerHTML = `
            <span class="flex items-center justify-center space-x-2">
                <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>Loading...</span>
            </span>
        `;
        
        const response = await fetch('/api/video-info', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ url: url })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to fetch video information');
        }
        
        if (data.success) {
            currentVideoData = { url: url, ...data.video_info };
            displayVideoInfo(data.video_info);
        } else {
            throw new Error(data.error || 'Unknown error occurred');
        }
        
    } catch (error) {
        console.error('Error fetching video info:', error);
        showError(error.message || 'Failed to fetch video information. Please try again.');
    } finally {
        fetchBtn.disabled = false;
        fetchBtn.innerHTML = `
            <span class="flex items-center justify-center space-x-2">
                <i data-feather="search" class="w-5 h-5"></i>
                <span>Get Video Info</span>
            </span>
        `;
        feather.replace();
    }
}

function displayVideoInfo(videoData) {
    hideAllStates();
    
    // Set video information
    document.getElementById('videoThumbnail').src = videoData.thumbnail || '';
    document.getElementById('videoTitle').textContent = videoData.title || 'Unknown Title';
    document.getElementById('videoUploader').textContent = videoData.uploader || 'Unknown';
    document.getElementById('videoDuration').textContent = formatDuration(videoData.duration);
    document.getElementById('videoViews').textContent = formatViews(videoData.view_count);
    
    // Create download options
    const downloadOptions = document.getElementById('downloadOptions');
    downloadOptions.innerHTML = '';
    
    if (videoData.available_qualities && videoData.available_qualities.length > 0) {
        videoData.available_qualities.forEach(quality => {
            const button = document.createElement('button');
            const isAudio = quality.type === 'audio' || quality.quality === 'Audio Only';
            const format = isAudio ? 'MP3 Format' : 'MP4 Format';
            const icon = isAudio ? 'music' : 'video';
            const bgColor = isAudio ? 'bg-green-100 group-hover:bg-green-200' : 'bg-blue-100 group-hover:bg-blue-200';
            const iconColor = isAudio ? 'text-green-600' : 'text-blue-600';
            const hoverColor = isAudio ? 'hover:bg-green-50 hover:border-green-300' : 'hover:bg-blue-50 hover:border-blue-300';
            const textColor = isAudio ? 'text-green-600 group-hover:text-green-700' : 'text-blue-600 group-hover:text-blue-700';
            
            button.className = `flex items-center justify-between w-full p-4 bg-gray-50 ${hoverColor} border border-gray-200 rounded-xl transition-all duration-200 group`;
            button.innerHTML = `
                <div class="flex items-center space-x-3">
                    <div class="w-10 h-10 ${bgColor} rounded-lg flex items-center justify-center">
                        <i data-feather="${icon}" class="w-5 h-5 ${iconColor}"></i>
                    </div>
                    <div class="text-left">
                        <div class="font-medium text-gray-900">${quality.quality} ${isAudio ? 'Music' : 'Video'}</div>
                        <div class="text-sm text-gray-500">${format}</div>
                    </div>
                </div>
                <div class="${textColor}">
                    <i data-feather="arrow-right" class="w-5 h-5"></i>
                </div>
            `;
            
            button.addEventListener('click', () => {
                startDownload(currentVideoData.url, quality.quality);
            });
            
            downloadOptions.appendChild(button);
        });
    } else {
        // Fallback: show default quality options including audio
        const options = [
            { quality: 'Audio Only', type: 'audio' },
            { quality: '360p', type: 'video' },
            { quality: '480p', type: 'video' },
            { quality: '720p', type: 'video' }
        ];
        
        options.forEach(option => {
            const button = document.createElement('button');
            const isAudio = option.type === 'audio';
            const format = isAudio ? 'MP3 Format' : 'MP4 Format';
            const icon = isAudio ? 'music' : 'video';
            const bgColor = isAudio ? 'bg-green-100 group-hover:bg-green-200' : 'bg-blue-100 group-hover:bg-blue-200';
            const iconColor = isAudio ? 'text-green-600' : 'text-blue-600';
            const hoverColor = isAudio ? 'hover:bg-green-50 hover:border-green-300' : 'hover:bg-blue-50 hover:border-blue-300';
            const textColor = isAudio ? 'text-green-600 group-hover:text-green-700' : 'text-blue-600 group-hover:text-blue-700';
            
            button.className = `flex items-center justify-between w-full p-4 bg-gray-50 ${hoverColor} border border-gray-200 rounded-xl transition-all duration-200 group`;
            button.innerHTML = `
                <div class="flex items-center space-x-3">
                    <div class="w-10 h-10 ${bgColor} rounded-lg flex items-center justify-center">
                        <i data-feather="${icon}" class="w-5 h-5 ${iconColor}"></i>
                    </div>
                    <div class="text-left">
                        <div class="font-medium text-gray-900">${option.quality} ${isAudio ? 'Music' : 'Video'}</div>
                        <div class="text-sm text-gray-500">${format}</div>
                    </div>
                </div>
                <div class="${textColor}">
                    <i data-feather="arrow-right" class="w-5 h-5"></i>
                </div>
            `;
            
            button.addEventListener('click', () => {
                startDownload(currentVideoData.url, option.quality);
            });
            
            downloadOptions.appendChild(button);
        });
    }
    
    feather.replace();
    showElement(videoInfo);
}

async function startDownload(url, quality) {
    try {
        hideAllStates();
        showElement(downloadProgress);
        
        // Reset progress
        document.getElementById('progressText').textContent = 'Preparing download...';
        document.getElementById('progressBar').style.width = '0%';
        document.getElementById('speedText').textContent = '';
        
        const response = await fetch('/api/download', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
                url: url, 
                quality: quality 
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to start download');
        }
        
        if (data.success) {
            // Start polling for progress
            pollDownloadProgress(data.download_id);
        } else {
            throw new Error(data.error || 'Unknown error occurred');
        }
        
    } catch (error) {
        console.error('Error starting download:', error);
        showError(error.message || 'Failed to start download. Please try again.');
    }
}

function pollDownloadProgress(downloadId) {
    downloadInterval = setInterval(async () => {
        try {
            const response = await fetch(`/api/download-progress/${downloadId}`);
            const data = await response.json();
            
            if (!response.ok) {
                clearInterval(downloadInterval);
                throw new Error(data.error || 'Failed to get download progress');
            }
            
            updateProgressDisplay(data);
            
            if (data.status === 'finished') {
                clearInterval(downloadInterval);
                // Automatically download the file
                downloadFile(downloadId);
            } else if (data.status === 'error') {
                clearInterval(downloadInterval);
                throw new Error(data.error || 'Download failed');
            }
            
        } catch (error) {
            clearInterval(downloadInterval);
            console.error('Error polling progress:', error);
            showError(error.message || 'Download failed. Please try again.');
        }
    }, 1000);
}

function updateProgressDisplay(progressData) {
    const progressText = document.getElementById('progressText');
    const progressBar = document.getElementById('progressBar');
    const speedText = document.getElementById('speedText');
    
    if (progressData.status === 'downloading') {
        progressText.textContent = `Downloading... ${progressData.percent}`;
        
        // Extract percentage number
        const percentMatch = progressData.percent.match(/(\d+(?:\.\d+)?)/);
        if (percentMatch) {
            const percentNum = parseFloat(percentMatch[1]);
            progressBar.style.width = `${percentNum}%`;
        }
        
        if (progressData.speed) {
            speedText.textContent = `Speed: ${progressData.speed}`;
        }
    } else if (progressData.status === 'finished') {
        progressText.textContent = 'Download completed!';
        progressBar.style.width = '100%';
        speedText.textContent = 'Preparing file for download...';
    }
}

function downloadFile(downloadId) {
    // Create a temporary link to trigger download
    const link = document.createElement('a');
    link.href = `/api/download-file/${downloadId}`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Show success message and reset
    setTimeout(() => {
        hideAllStates();
        videoUrlInput.value = '';
        videoUrlInput.focus();
        
        // Show success notification
        const successDiv = document.createElement('div');
        successDiv.className = 'fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50';
        successDiv.textContent = 'Download completed successfully!';
        document.body.appendChild(successDiv);
        
        setTimeout(() => {
            document.body.removeChild(successDiv);
        }, 3000);
    }, 1000);
}

// Smooth scrolling for navigation links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Initialize feather icons
document.addEventListener('DOMContentLoaded', function() {
    feather.replace();
    
    // Focus on URL input
    videoUrlInput.focus();
});

// Handle paste events
videoUrlInput.addEventListener('paste', function(e) {
    // Small delay to allow paste to complete
    setTimeout(() => {
        const url = this.value.trim();
        if (isValidYouTubeUrl(url)) {
            fetchBtn.classList.add('bg-green-600');
            fetchBtn.classList.remove('bg-gradient-to-r', 'from-blue-600', 'to-purple-600');
            setTimeout(() => {
                fetchBtn.classList.remove('bg-green-600');
                fetchBtn.classList.add('bg-gradient-to-r', 'from-blue-600', 'to-purple-600');
            }, 1000);
        }
    }, 100);
});

// Handle Enter key in URL input
videoUrlInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        urlForm.dispatchEvent(new Event('submit'));
    }
});

// Clean up intervals on page unload
window.addEventListener('beforeunload', () => {
    if (downloadInterval) {
        clearInterval(downloadInterval);
    }
});
