# app/extensions/uploads.py
import os
from werkzeug.utils import secure_filename
from flask import current_app, url_for

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}
MAX_CONTENT_LENGTH = 5 * 1024 * 1024  # 5 MB


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def save_files(files, upload_dir):
    urls = []
    for file in files:
        if file and allowed_file(file.filename):
            filename = secure_filename(file.filename)
            path = os.path.join(upload_dir, filename)
            file.save(path)
            urls.append(url_for('uploaded_file', filename=filename))
    return urls