import os
import logging
import json
import tempfile
import shutil
from urllib.parse import urlparse, parse_qs
from flask import Flask, render_template, request, jsonify, send_file, abort
from flask_cors import CORS
import yt_dlp
import threading
import uuid
from werkzeug.middleware.proxy_fix import ProxyFix

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Create Flask app
app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", "dev-secret-key-change-in-production")
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

# Enable CORS for all routes
CORS(app)

# Global dictionary to store download progress
download_progress = {}

class ProgressHook:
    def __init__(self, download_id):
        self.download_id = download_id
        
    def __call__(self, d):
        if d['status'] == 'downloading':
            percent = d.get('_percent_str', '0%').strip()
            speed = d.get('_speed_str', 'N/A')
            download_progress[self.download_id] = {
                'status': 'downloading',
                'percent': percent,
                'speed': speed
            }
        elif d['status'] == 'finished':
            download_progress[self.download_id] = {
                'status': 'finished',
                'percent': '100%',
                'filename': d.get('filename', '')
            }

def is_valid_youtube_url(url):
    """Check if the URL is a valid YouTube URL"""
    try:
        parsed = urlparse(url)
        # Handle various YouTube URL formats
        if parsed.netloc in ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'music.youtube.com']:
            return True
        elif parsed.netloc in ['youtu.be', 'www.youtu.be']:
            return True
        elif 'youtube.com' in parsed.netloc:
            return True
        return False
    except:
        return False

def extract_video_info(url):
    """Extract video information using yt-dlp"""
    try:
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            if not info:
                raise Exception("Failed to extract video information")
            
            # Get available formats
            formats = info.get('formats', []) if info else []
            
            # Find video formats and audio-only format
            available_qualities = []
            audio_format = None
            
            # Find best audio format first for audio-only option
            for fmt in formats:
                if (fmt and fmt.get('acodec') != 'none' and 
                    fmt.get('vcodec') == 'none'):
                    audio_format = fmt
                    break
            
            # Add audio-only option if available
            if audio_format:
                available_qualities.append({
                    'format_id': audio_format['format_id'],
                    'quality': 'Audio Only',
                    'ext': 'mp3',
                    'filesize': audio_format.get('filesize'),
                    'type': 'audio'
                })
            
            # Find 360p, 480p and 720p formats with both video and audio
            video_qualities = {}
            for fmt in formats:
                height = fmt.get('height') if fmt else None
                if height in [360, 480, 720] and fmt.get('vcodec') != 'none' and fmt.get('acodec') != 'none':
                    # Keep the best format for each height
                    if height not in video_qualities or (fmt.get('filesize', 0) or 0) > (video_qualities[height].get('filesize', 0) or 0):
                        video_qualities[height] = {
                            'format_id': fmt['format_id'],
                            'quality': f"{height}p",
                            'ext': fmt.get('ext', 'mp4'),
                            'filesize': fmt.get('filesize'),
                            'type': 'video'
                        }
            
            # Add video qualities to available options
            for height in sorted(video_qualities.keys()):
                available_qualities.append(video_qualities[height])
            
            # If no combined formats, look for best video + audio combination for each quality
            video_qualities_found = [q for q in available_qualities if q.get('type') == 'video']
            if not video_qualities_found:
                for height in [360, 480, 720]:
                    video_format = None
                    
                    # Find best video format for this height
                    for fmt in formats:
                        if (fmt and fmt.get('height') == height and 
                            fmt.get('vcodec') != 'none' and 
                            fmt.get('acodec') == 'none'):
                            video_format = fmt
                            break
                    
                    if video_format and audio_format:
                        available_qualities.append({
                            'format_id': f"{video_format['format_id']}+{audio_format['format_id']}",
                            'quality': f"{height}p",
                            'ext': 'mp4',
                            'filesize': None,
                            'type': 'video'
                        })
            
            # Ensure we always have the three video qualities available as fallback
            existing_video_qualities = {int(q['quality'].replace('p', '')) for q in available_qualities if q.get('type') == 'video'}
            for height in [360, 480, 720]:
                if height not in existing_video_qualities:
                    available_qualities.append({
                        'format_id': f'best[height<={height}]',
                        'quality': f"{height}p",
                        'ext': 'mp4',
                        'filesize': None,
                        'type': 'video'
                    })
            
            return {
                'title': info.get('title', 'Unknown Title') if info else 'Unknown Title',
                'duration': info.get('duration', 0) if info else 0,
                'uploader': info.get('uploader', 'Unknown') if info else 'Unknown',
                'view_count': info.get('view_count', 0) if info else 0,
                'upload_date': info.get('upload_date', '') if info else '',
                'thumbnail': info.get('thumbnail', '') if info else '',
                'available_qualities': available_qualities
            }
    except Exception as e:
        logger.error(f"Error extracting video info: {str(e)}")
        raise e

@app.route('/')
def index():
    """Serve the main page"""
    return render_template('index.html')

@app.route('/api/video-info', methods=['POST'])
def get_video_info():
    """Get video information from YouTube URL"""
    try:
        data = request.get_json()
        url = data.get('url', '').strip()
        
        if not url:
            return jsonify({'error': 'URL is required'}), 400
        
        if not is_valid_youtube_url(url):
            return jsonify({'error': 'Please enter a valid YouTube URL'}), 400
        
        video_info = extract_video_info(url)
        
        return jsonify({
            'success': True,
            'video_info': video_info
        })
        
    except Exception as e:
        logger.error(f"Error getting video info: {str(e)}")
        return jsonify({'error': f'Failed to fetch video information: {str(e)}'}), 500

@app.route('/api/download', methods=['POST'])
def download_video():
    """Download video with specified quality"""
    try:
        data = request.get_json()
        url = data.get('url', '').strip()
        quality = data.get('quality', '720p')
        
        if not url or not is_valid_youtube_url(url):
            return jsonify({'error': 'Valid YouTube URL is required'}), 400
        
        # Generate unique download ID
        download_id = str(uuid.uuid4())
        
        # Initialize progress tracking
        download_progress[download_id] = {
            'status': 'starting',
            'percent': '0%',
            'speed': 'N/A'
        }
        
        # Create temporary directory for download
        temp_dir = tempfile.mkdtemp()
        
        # Configure yt-dlp options based on quality type
        if quality == 'Audio Only':
            ydl_opts = {
                'format': 'bestaudio/best',
                'outtmpl': os.path.join(temp_dir, '%(title)s.%(ext)s'),
                'progress_hooks': [ProgressHook(download_id)],
                'postprocessors': [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': '192',
                }],
                'writeinfojson': False,
                'writesubtitles': False,
                'writeautomaticsub': False,
            }
        else:
            height = int(quality.replace('p', ''))
            # Use more specific format selection for better quality
            format_selector = f'best[height<={height}][ext=mp4]/best[height<={height}]/bestvideo[height<={height}]+bestaudio/best[height<={height}]'
            ydl_opts = {
                'format': format_selector,
                'outtmpl': os.path.join(temp_dir, '%(title)s.%(ext)s'),
                'progress_hooks': [ProgressHook(download_id)],
                'merge_output_format': 'mp4',
                'writeinfojson': False,
                'writesubtitles': False,
                'writeautomaticsub': False,
            }
        
        def download_thread():
            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    ydl.download([url])
            except Exception as e:
                download_progress[download_id] = {
                    'status': 'error',
                    'error': str(e)
                }
        
        # Start download in background thread
        thread = threading.Thread(target=download_thread)
        thread.daemon = True
        thread.start()
        
        return jsonify({
            'success': True,
            'download_id': download_id,
            'temp_dir': temp_dir
        })
        
    except Exception as e:
        logger.error(f"Error starting download: {str(e)}")
        return jsonify({'error': f'Failed to start download: {str(e)}'}), 500

@app.route('/api/download-progress/<download_id>')
def get_download_progress(download_id):
    """Get download progress"""
    if download_id not in download_progress:
        return jsonify({'error': 'Download not found'}), 404
    
    return jsonify(download_progress[download_id])

@app.route('/api/download-file/<download_id>')
def download_file(download_id):
    """Serve the downloaded file"""
    try:
        if download_id not in download_progress:
            return jsonify({'error': 'Download not found'}), 404
        
        progress = download_progress[download_id]
        
        if progress.get('status') != 'finished':
            return jsonify({'error': 'Download not finished'}), 400
        
        filename = progress.get('filename')
        if not filename or not os.path.exists(filename):
            return jsonify({'error': 'File not found'}), 404
        
        # Get just the filename without path
        basename = os.path.basename(filename)
        
        def remove_file():
            """Remove file after sending"""
            try:
                if os.path.exists(filename):
                    os.remove(filename)
                # Remove temp directory
                temp_dir = os.path.dirname(filename)
                if os.path.exists(temp_dir):
                    shutil.rmtree(temp_dir)
                # Clean up progress tracking
                if download_id in download_progress:
                    del download_progress[download_id]
            except Exception as e:
                logger.error(f"Error cleaning up file: {str(e)}")
        
        # Schedule cleanup after file is sent
        def cleanup_after_send(response):
            threading.Thread(target=remove_file, daemon=True).start()
            return response
        
        # Determine MIME type based on file extension
        mimetype = 'video/mp4'
        if filename.lower().endswith('.mp3'):
            mimetype = 'audio/mpeg'
        elif filename.lower().endswith('.m4a'):
            mimetype = 'audio/m4a'
        
        return send_file(
            filename,
            as_attachment=True,
            download_name=basename,
            mimetype=mimetype
        )
        
    except Exception as e:
        logger.error(f"Error serving download file: {str(e)}")
        return jsonify({'error': f'Failed to serve file: {str(e)}'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
