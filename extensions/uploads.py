# app/extensions/uploads.py
import os
from werkzeug.utils import secure_filename
from flask import current_app, url_for

MAX_CONTENT_LENGTH = 25 * 1024 * 1024  # 25 MB

# Allow common images, iOS HEIC/HEIF, and a few video formats.
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'mp4', 'webm', 'ogg', 'mov', 'm4v', 'hevc', 'heic', 'heif'}
VIDEO_EXTENSIONS = {'mp4', 'webm', 'ogg', 'mov', 'm4v', 'hevc'}

def allowed_file(filename):
    if '.' not in filename:
        return False
    ext = filename.rsplit('.', 1)[1].lower()
    return ext in ALLOWED_EXTENSIONS

def is_video(filename):
    return filename.rsplit('.', 1)[1].lower() in VIDEO_EXTENSIONS

def save_files(files, upload_dir):
    urls = []
    for file in files:
        if file and allowed_file(file.filename):
            filename = secure_filename(file.filename)
            path = os.path.join(upload_dir, filename)
            file.save(path)
            urls.append(url_for('uploaded_file', filename=filename))
    return urls
