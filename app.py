from flask import Flask, request, jsonify, session, redirect, url_for, render_template, send_from_directory, abort, g
from flask_sqlalchemy import SQLAlchemy
from flask_bcrypt import Bcrypt
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from functools import wraps
import os
import secrets
import requests
import base64
from datetime import datetime
from uuid import uuid4
from werkzeug.utils import secure_filename
from sqlalchemy import inspect, text, or_


from extensions.uploads import save_files, ALLOWED_EXTENSIONS, MAX_CONTENT_LENGTH
from extensions.s3_upload import upload_file_to_s3, upload_bytes_to_s3, presign_keys



app = Flask(__name__)
app.config['SECRET_KEY'] = 'supersecretkey'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///groupo.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = 'static/uploads'
USE_S3 = os.environ.get('RENDER') == 'true'
if USE_S3:
    print("[startup] RENDER=true detected; will attempt S3 uploads. Ensure AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/S3_BUCKET_NAME are set.")
MAX_MEDIA_PER_POST = int(os.environ.get('MAX_MEDIA_PER_POST', 20))

bcrypt = Bcrypt(app)
db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login_page'

def _ensure_schema_columns():
    inspector = inspect(db.engine)
    for table in ("user", "post", "comment"):
        cols = [c["name"] for c in inspector.get_columns(table)]
        if "created_at" not in cols:
            with db.engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN created_at TIMESTAMP"))
                conn.execute(text(f"UPDATE {table} SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL"))
    user_cols = [c["name"] for c in inspector.get_columns("user")]
    if "phone_number" not in user_cols:
        with db.engine.begin() as conn:
            conn.execute(text("ALTER TABLE user ADD COLUMN phone_number VARCHAR(20)"))
    group_cols = [c["name"] for c in inspector.get_columns("group")]
    if "kind" not in group_cols:
        with db.engine.begin() as conn:
            conn.execute(text("ALTER TABLE \"group\" ADD COLUMN kind VARCHAR(20) DEFAULT 'group'"))
    with db.engine.begin() as conn:
        conn.execute(text("UPDATE \"group\" SET kind = 'group' WHERE kind IS NULL OR kind = ''"))
    if "owner_id" not in group_cols:
        with db.engine.begin() as conn:
            conn.execute(text("ALTER TABLE \"group\" ADD COLUMN owner_id INTEGER"))
    if "parent_group_id" not in group_cols:
        with db.engine.begin() as conn:
            conn.execute(text("ALTER TABLE \"group\" ADD COLUMN parent_group_id INTEGER"))

if not os.path.exists(app.config['UPLOAD_FOLDER']):
    os.makedirs(app.config['UPLOAD_FOLDER'])

class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password = db.Column(db.String(200), nullable=False)
    first_name = db.Column(db.String(100), nullable=False)
    last_name = db.Column(db.String(100), nullable=False)
    phone_number = db.Column(db.String(20), unique=True)
    api_token = db.Column(db.String(128), unique=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

class Group(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    kind = db.Column(db.String(20), default='group', nullable=False)
    owner_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    parent_group_id = db.Column(db.Integer, db.ForeignKey('group.id'))
    owner = db.relationship('User', foreign_keys=[owner_id])
    members = db.relationship('User', secondary='group_members', backref='groups')

class Post(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.Text, nullable=False)
    image_urls = db.Column(db.Text)  # Comma-separated URLs or S3 keys
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    group_id = db.Column(db.Integer, db.ForeignKey('group.id'), nullable=False)
    likes = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    comments = db.relationship('Comment', backref='post', cascade="all, delete-orphan")
    user = db.relationship('User')

class Comment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.String(300), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    post_id = db.Column(db.Integer, db.ForeignKey('post.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    user = db.relationship('User')

class GroupMembers(db.Model):
    __tablename__ = 'group_members'
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), primary_key=True)
    group_id = db.Column(db.Integer, db.ForeignKey('group.id'), primary_key=True)

class GroupNameAlias(db.Model):
    __tablename__ = 'group_name_alias'
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), primary_key=True)
    group_id = db.Column(db.Integer, db.ForeignKey('group.id'), primary_key=True)
    name = db.Column(db.String(100), nullable=False)

class PostAlbum(db.Model):
    __tablename__ = 'post_album'
    post_id = db.Column(db.Integer, db.ForeignKey('post.id'), primary_key=True)
    album_id = db.Column(db.Integer, db.ForeignKey('group.id'), primary_key=True)

friends = db.Table('friends',
    db.Column('user_id', db.Integer, db.ForeignKey('user.id')),
    db.Column('friend_id', db.Integer, db.ForeignKey('user.id'))
)

with app.app_context():
    db.create_all()
    try:
        _ensure_schema_columns()
    except Exception as exc:
        print(f"[startup] failed to ensure schema columns: {exc}")


def store_files(files):
    """Save uploads locally or to S3 depending on environment."""
    if USE_S3:
        try:
            keys = upload_file_to_s3(files)
            print(f"[upload] S3 stored files: {keys}")
            return keys
        except Exception as exc:
            print(f"[upload] S3 upload failed, falling back to local: {exc}")
    return save_files(files, app.config['UPLOAD_FOLDER'])


MIME_EXTENSION_MAP = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/ogg': 'ogg',
    'video/quicktime': 'mov',
    'video/hevc': 'hevc',
    'video/x-m4v': 'm4v',
}


def _normalize_filename(name, mime_type):
    filename = secure_filename(name) if name else ''
    ext = filename.rsplit('.', 1)[1].lower() if '.' in filename else None
    if not ext:
        ext = MIME_EXTENSION_MAP.get(mime_type or '')
        if ext:
            filename = f"upload.{ext}"
    if not ext:
        ext = 'jpg'
        filename = f"upload.{ext}"
    if ext not in ALLOWED_EXTENSIONS:
        return None
    return filename


def store_base64_files(files):
    items = []
    for payload in files:
        data = payload.get('data') or payload.get('base64')
        if not data:
            print("[upload] base64 skip: missing data")
            continue
        if isinstance(data, str) and data.startswith('data:') and ',' in data:
            data = data.split(',', 1)[1]
        try:
            raw = base64.b64decode(data)
        except Exception:
            print("[upload] base64 skip: decode failed")
            continue
        mime_type = payload.get('mimeType') or payload.get('mime_type')
        filename = _normalize_filename(payload.get('name'), mime_type)
        if not filename:
            print(f"[upload] base64 skip: invalid filename or mime name={payload.get('name')} mime={mime_type}")
            continue
        unique = f"{uuid4().hex}_{filename}"
        items.append({
            "filename": unique,
            "content_type": mime_type or 'application/octet-stream',
            "data": raw,
        })
    if not items:
        return []
    if USE_S3:
        try:
            return upload_bytes_to_s3(items)
        except Exception as exc:
            print(f"[upload] S3 base64 upload failed, falling back to local: {exc}")

    urls = []
    for item in items:
        path = os.path.join(app.config['UPLOAD_FOLDER'], item["filename"])
        with open(path, 'wb') as f:
            f.write(item["data"])
        urls.append(url_for('uploaded_file', filename=item["filename"]))
    return urls


def _split_image_urls(image_urls):
    return image_urls.split(',') if image_urls else []


def _resolve_image_urls(image_urls):
    urls = _split_image_urls(image_urls)
    if not urls:
        return []
    if USE_S3:
        try:
            return presign_keys(urls)
        except Exception as exc:
            print(f"[upload] presign failed, returning raw keys: {exc}")
            return urls
    return urls


def _normalize_phone_number(value):
    if not value:
        return None
    digits = ''.join(ch for ch in str(value) if ch.isdigit())
    if len(digits) < 10:
        return None
    return digits


def _public_user_payload(user: User):
    return {
        "id": user.id,
        "username": user.username,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "phone_number": user.phone_number,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


def _group_name_for_user(group: Group, user: User):
    if group.kind == 'album':
        return group.name
    alias = GroupNameAlias.query.filter_by(group_id=group.id, user_id=user.id).first()
    return alias.name if alias and alias.name else group.name


def _parse_album_ids(raw):
    if raw is None:
        return []
    if isinstance(raw, list):
        values = []
        for item in raw:
            if isinstance(item, str) and ',' in item:
                values.extend([v.strip() for v in item.split(',') if v.strip()])
            else:
                values.append(item)
    elif isinstance(raw, str):
        values = [v.strip() for v in raw.split(',') if v.strip()]
    else:
        values = [raw]
    ids = []
    for value in values:
        try:
            ids.append(int(value))
        except (TypeError, ValueError):
            continue
    # Keep order, remove duplicates.
    return list(dict.fromkeys(ids))


def _albums_for_post(post: Post):
    links = PostAlbum.query.filter_by(post_id=post.id).all()
    album_ids = [l.album_id for l in links]
    albums = []
    if album_ids:
        albums = Group.query.filter(Group.id.in_(album_ids), Group.kind == 'album').all()
    by_id = {a.id: a for a in albums}
    ordered = [by_id[i] for i in album_ids if i in by_id]
    primary_group = Group.query.get(post.group_id)
    if primary_group and primary_group.kind == 'album' and all(a.id != primary_group.id for a in ordered):
        ordered.insert(0, primary_group)
    return ordered


def _serialize_post(post: Post, viewer: User, fallback_group_name: str | None = None):
    primary_group = Group.query.get(post.group_id)
    if primary_group and primary_group.kind == 'album':
        display_name = primary_group.name
    elif primary_group:
        display_name = _group_name_for_user(primary_group, viewer)
    else:
        display_name = fallback_group_name or ''
    associated_albums = _albums_for_post(post)
    return {
        "id": post.id,
        "content": post.content,
        "image_urls": _resolve_image_urls(post.image_urls),
        "user": post.user.username,
        "user_id": post.user_id,
        "created_at": post.created_at.isoformat() if post.created_at else None,
        "likes": post.likes,
        "group_id": post.group_id,
        "group_name": display_name,
        "associated_albums": [
            {"id": album.id, "name": album.name, "parent_group_id": album.parent_group_id}
            for album in associated_albums
        ],
        "comments": [{
            "id": c.id,
            "content": c.content,
            "user": c.user.username,
            "user_id": c.user_id,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        } for c in post.comments]
    }

class DeviceToken(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    token = db.Column(db.String(255), nullable=False)
    platform = db.Column(db.String(50), default='expo')  # expo, ios, android
    user = db.relationship('User', backref='device_tokens')

User.friends = db.relationship(
    'User', secondary=friends,
    primaryjoin=(friends.c.user_id == User.id),
    secondaryjoin=(friends.c.friend_id == User.id)
)

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

@app.route('/')
def home():
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))
    return render_template('home.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    return render_template('home.html')
    # if request.method == 'POST':
    #     data = request.form
    #     hashed_pw = bcrypt.generate_password_hash(data['password']).decode('utf-8')
    #     user = User(
    #         username=data['username'],
    #         password=hashed_pw,
    #         first_name=data['first_name'],
    #         last_name=data['last_name']
    #     )
    #     db.session.add(user)
    #     db.session.commit()
    #     return redirect(url_for('login_page'))
    # return render_template('register.html')


@app.route('/login', methods=['GET', 'POST'])
def login_page():
    if request.method == 'POST':
        data = request.form
        user = User.query.filter_by(username=data['username']).first()
        if user and bcrypt.check_password_hash(user.password, data['password']):
            login_user(user)
            return redirect(url_for('dashboard'))
        return render_template('login.html', error='Invalid credentials')
    return render_template('login.html')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('home'))

@app.route('/dashboard')
@login_required
def dashboard():
    groups = current_user.groups
    return render_template('dashboard.html', groups=groups)

@app.route('/groups', methods=['GET', 'POST'])
@login_required
def create_group():
    if request.method == 'POST':
        data = request.form or request.get_json() or {}
        group = Group(name=data['name'])
        group.members.append(current_user)
        db.session.add(group)
        db.session.commit()
        # If JSON, return API-friendly response
        if request.is_json:
            return jsonify({"id": group.id, "name": group.name})
        return redirect(url_for('dashboard'))
    return render_template('create_group.html')

@app.route('/groups/<int:group_id>/join', methods=['POST'])
@login_required
def join_group(group_id):
    group = Group.query.get_or_404(group_id)
    user_id = request.json.get('user_id') or current_user.id
    user = User.query.get_or_404(user_id)
    if user not in group.members:
        group.members.append(user)
        db.session.commit()
    return jsonify(message='User added to group')

@app.route('/groups/<int:group_id>/posts', methods=['GET', 'POST'])
@login_required
def group_posts(group_id):
    group = Group.query.get_or_404(group_id)
    if current_user not in group.members:
        return redirect(url_for('dashboard'))

    if request.method == 'POST':
        content = request.form.get('content')
        files = request.files.getlist('file')
        if len(files) > MAX_MEDIA_PER_POST:
            return abort(400, description=f"Too many files (max {MAX_MEDIA_PER_POST}).")
        image_urls = store_files(files)
        post = Post(content=content, user_id=current_user.id, group_id=group.id, image_urls=','.join(image_urls))
        db.session.add(post)
        db.session.commit()
        return redirect(url_for('group_posts', group_id=group_id))

    posts = Post.query.filter_by(group_id=group.id).order_by(Post.id.desc()).all()
    image_urls_map = {p.id: _resolve_image_urls(p.image_urls) for p in posts}
    return render_template('group_posts.html', group=group, posts=posts, image_urls_map=image_urls_map)

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/like_post/<int:post_id>', methods=['POST'])
@login_required
def like_post(post_id):
    post = Post.query.get_or_404(post_id)
    post.likes += 1
    db.session.commit()
    return jsonify({"likes": post.likes})

@app.route('/comment_post/<int:post_id>', methods=['POST'])
@login_required
def comment_post(post_id):
    content = request.form.get('comment')
    post = Post.query.get_or_404(post_id)
    comment = Comment(content=content, user_id=current_user.id, post=post)
    db.session.add(comment)
    db.session.commit()
    group = Group.query.get(post.group_id)
    if group:
        notify_group_members_comment(group, current_user, post, comment)
    return jsonify({"message": "Comment added."})

@app.route('/delete_post/<int:post_id>', methods=['POST'])
@login_required
def delete_post(post_id):
    post = Post.query.get_or_404(post_id)
    if post.user_id != current_user.id:
        abort(403)  # Forbidden if not the owner

    db.session.delete(post)
    db.session.commit()
    return jsonify({"message": "Post deleted"})

@app.route('/search_users')
@login_required
def search_users():
    q = request.args.get('q', '')
    users = User.query.filter(
        (User.username.ilike(f'%{q}%')) |
        (User.first_name.ilike(f'%{q}%')) |
        (User.last_name.ilike(f'%{q}%'))
    ).all()
    return jsonify(results=[{
        'id': u.id,
        'username': u.username,
        'first_name': u.first_name,
        'last_name': u.last_name
    } for u in users if u.id != current_user.id])

@app.route('/add_friend/<int:user_id>', methods=['POST'])
@login_required
def add_friend(user_id):
    friend = User.query.get_or_404(user_id)
    if friend not in current_user.friends:
        current_user.friends.append(friend)
        db.session.commit()
    return jsonify(message='Friend added!')

# --- API utilities and mobile endpoints ---

def generate_api_token():
    return secrets.token_hex(32)


def get_api_user():
    token = request.headers.get('Authorization', '').replace('Bearer ', '').strip() or request.args.get('token')
    if not token:
        return None
    return User.query.filter_by(api_token=token).first()


def token_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        user = get_api_user()
        if not user:
            return jsonify({"error": "Unauthorized"}), 401
        g.api_user = user
        return f(*args, **kwargs)
    return wrapper


def notify_group_members(group: Group, actor: User, post: Post):
    member_ids = [m.id for m in group.members if m.id != actor.id]
    tokens = DeviceToken.query.filter(DeviceToken.user_id.in_(member_ids)).all()
    if not tokens:
        return

    expo_endpoint = os.environ.get("EXPO_PUSH_URL", "https://exp.host/--/api/v2/push/send")
    for t in tokens:
        payload = {
            "to": t.token,
            "title": f"New post in {group.name}",
            "body": f"{actor.username} posted: {post.content[:80]}",
            "data": {"group_id": group.id, "post_id": post.id},
        }
        try:
            resp = requests.post(expo_endpoint, json=payload, timeout=5)
            if resp.status_code != 200:
                print(f"[notify] failed status={resp.status_code} token={t.token} body={resp.text}")
        except Exception as exc:
            print(f"[notify] error token={t.token} exc={exc}")


def notify_group_members_comment(group: Group, actor: User, post: Post, comment: Comment):
    # Notify all group/album members except the actor.
    # This includes the post owner (if different from actor).
    skip_ids = {actor.id}
    member_ids = [m.id for m in group.members if m.id not in skip_ids]
    tokens = DeviceToken.query.filter(DeviceToken.user_id.in_(member_ids)).all()
    if not tokens:
        return

    expo_endpoint = os.environ.get("EXPO_PUSH_URL", "https://exp.host/--/api/v2/push/send")
    for t in tokens:
        payload = {
            "to": t.token,
            "title": f"New comment in {group.name}",
            "body": f"{actor.username}: {comment.content[:80]}",
            "data": {"group_id": group.id, "post_id": post.id, "comment_id": comment.id, "type": "comment"},
        }
        try:
            resp = requests.post(expo_endpoint, json=payload, timeout=5)
            if resp.status_code != 200:
                print(f"[notify] failed status={resp.status_code} token={t.token} body={resp.text}")
        except Exception as exc:
            print(f"[notify] error token={t.token} exc={exc}")


def notify_post_owner_like(actor: User, post: Post):
    if not post.user_id or post.user_id == actor.id:
        return
    tokens = DeviceToken.query.filter_by(user_id=post.user_id).all()
    if not tokens:
        return
    group = Group.query.get(post.group_id)
    group_name = group.name if group else "your group"
    expo_endpoint = os.environ.get("EXPO_PUSH_URL", "https://exp.host/--/api/v2/push/send")
    for t in tokens:
        payload = {
            "to": t.token,
            "title": "New like",
            "body": f"{actor.username} liked your post in {group_name}",
            "data": {"group_id": post.group_id, "post_id": post.id, "type": "like"},
        }
        try:
            resp = requests.post(expo_endpoint, json=payload, timeout=5)
            if resp.status_code != 200:
                print(f"[notify] failed status={resp.status_code} token={t.token} body={resp.text}")
        except Exception as exc:
            print(f"[notify] error token={t.token} exc={exc}")


def notify_album_members_post(albums, actor: User, post: Post):
    member_ids = set()
    for album in albums:
        for member in album.members:
            if member.id != actor.id:
                member_ids.add(member.id)
    if not member_ids:
        return
    tokens = DeviceToken.query.filter(DeviceToken.user_id.in_(list(member_ids))).all()
    if not tokens:
        return
    album_names = ", ".join(album.name for album in albums[:2])
    if len(albums) > 2:
        album_names += "..."
    expo_endpoint = os.environ.get("EXPO_PUSH_URL", "https://exp.host/--/api/v2/push/send")
    for t in tokens:
        payload = {
            "to": t.token,
            "title": "New post",
            "body": f"{actor.username} posted in {album_names}",
            "data": {"post_id": post.id, "type": "post"},
        }
        try:
            resp = requests.post(expo_endpoint, json=payload, timeout=5)
            if resp.status_code != 200:
                print(f"[notify] failed status={resp.status_code} token={t.token} body={resp.text}")
        except Exception as exc:
            print(f"[notify] error token={t.token} exc={exc}")


def _resolve_target_albums(primary_album: Group, actor: User, album_ids):
    if primary_album.kind != 'album':
        return {"error": "Not an album"}
    target_ids = [primary_album.id]
    for album_id in album_ids:
        if album_id != primary_album.id:
            target_ids.append(album_id)
    target_ids = list(dict.fromkeys(target_ids))
    albums = Group.query.filter(Group.id.in_(target_ids), Group.kind == 'album').all()
    found = {a.id for a in albums}
    missing = [aid for aid in target_ids if aid not in found]
    if missing:
        return {"error": "Some selected albums were not found"}
    by_id = {a.id: a for a in albums}
    ordered = [by_id[aid] for aid in target_ids]
    root = primary_album.parent_group_id
    for album in ordered:
        if actor not in album.members:
            return {"error": "Forbidden"}
        if album.parent_group_id != root:
            return {"error": "Selected albums must belong to the same group"}
    return {"albums": ordered}


def _attach_post_to_albums(post: Post, albums):
    for album in albums:
        exists = PostAlbum.query.filter_by(post_id=post.id, album_id=album.id).first()
        if not exists:
            db.session.add(PostAlbum(post_id=post.id, album_id=album.id))


@app.route('/api/register', methods=['POST'])
def api_register():
    data = request.get_json() or {}
    required = ['username', 'password', 'first_name', 'last_name']
    if not all(k in data for k in required):
        return jsonify({"error": "Missing fields"}), 400
    if User.query.filter_by(username=data['username']).first():
        return jsonify({"error": "Username taken"}), 400
    phone_number = _normalize_phone_number(data.get('phone_number'))
    if data.get('phone_number') and not phone_number:
        return jsonify({"error": "Phone number must include at least 10 digits"}), 400
    if phone_number and User.query.filter_by(phone_number=phone_number).first():
        return jsonify({"error": "Phone number already in use"}), 400
    hashed_pw = bcrypt.generate_password_hash(data['password']).decode('utf-8')
    user = User(
        username=data['username'],
        password=hashed_pw,
        first_name=data['first_name'],
        last_name=data['last_name'],
        phone_number=phone_number,
        api_token=generate_api_token()
    )
    db.session.add(user)
    db.session.commit()
    return jsonify({"token": user.api_token, "user": _public_user_payload(user)})


@app.route('/api/login', methods=['POST'])
def api_login():
    data = request.get_json() or {}
    user = User.query.filter_by(username=data.get('username')).first()
    if not user or not bcrypt.check_password_hash(user.password, data.get('password', '')):
        return jsonify({"error": "Invalid credentials"}), 401
    if not user.api_token:
        user.api_token = generate_api_token()
    db.session.commit()
    return jsonify({"token": user.api_token, "user": _public_user_payload(user)})


@app.route('/api/me', methods=['GET', 'PATCH', 'DELETE'])
@token_required
def api_me():
    if request.method == 'GET':
        return jsonify({"user": _public_user_payload(g.api_user)})

    if request.method == 'DELETE':
        user = g.api_user
        user_post_ids = [p.id for p in Post.query.filter_by(user_id=user.id).all()]
        if user_post_ids:
            PostAlbum.query.filter(PostAlbum.post_id.in_(user_post_ids)).delete(synchronize_session=False)
        Comment.query.filter_by(user_id=user.id).delete()
        Post.query.filter_by(user_id=user.id).delete()
        GroupMembers.query.filter_by(user_id=user.id).delete()
        DeviceToken.query.filter_by(user_id=user.id).delete()
        GroupNameAlias.query.filter_by(user_id=user.id).delete()
        db.session.execute(text("DELETE FROM friends WHERE user_id = :uid OR friend_id = :uid"), {"uid": user.id})
        db.session.delete(user)
        db.session.commit()
        return jsonify({"message": "Account deleted"})

    data = request.get_json() or {}
    first_name = (data.get('first_name') or '').strip()
    last_name = (data.get('last_name') or '').strip()
    phone_number_raw = data.get('phone_number')
    if first_name:
        g.api_user.first_name = first_name
    if last_name:
        g.api_user.last_name = last_name
    if phone_number_raw is not None:
        if str(phone_number_raw).strip() == '':
            g.api_user.phone_number = None
        else:
            phone_number = _normalize_phone_number(phone_number_raw)
            if not phone_number:
                return jsonify({"error": "Phone number must include at least 10 digits"}), 400
            existing = User.query.filter(User.phone_number == phone_number, User.id != g.api_user.id).first()
            if existing:
                return jsonify({"error": "Phone number already in use"}), 400
            g.api_user.phone_number = phone_number
    db.session.commit()
    return jsonify({"user": _public_user_payload(g.api_user)})


@app.route('/api/me/password', methods=['POST'])
@token_required
def api_change_password():
    data = request.get_json() or {}
    current_password = data.get('current_password') or ''
    new_password = data.get('new_password') or ''
    if not current_password or not new_password:
        return jsonify({"error": "Current and new password are required"}), 400
    if len(new_password) < 8:
        return jsonify({"error": "New password must be at least 8 characters"}), 400
    if not bcrypt.check_password_hash(g.api_user.password, current_password):
        return jsonify({"error": "Current password is incorrect"}), 400
    g.api_user.password = bcrypt.generate_password_hash(new_password).decode('utf-8')
    db.session.commit()
    return jsonify({"message": "Password updated"})


@app.route('/api/push/register', methods=['POST'])
@token_required
def api_register_push():
    data = request.get_json() or {}
    token = data.get('token')
    platform = data.get('platform', 'ios')
    if not token:
        return jsonify({"error": "Missing token"}), 400
    # Keep each physical push token bound to exactly one user at a time.
    # This prevents cross-account notifications when testing multiple accounts on one device.
    existing_for_token = DeviceToken.query.filter_by(token=token).all()
    if not existing_for_token:
        dt = DeviceToken(user_id=g.api_user.id, token=token, platform=platform)
        db.session.add(dt)
    else:
        primary = existing_for_token[0]
        primary.user_id = g.api_user.id
        primary.platform = platform
        for duplicate in existing_for_token[1:]:
            db.session.delete(duplicate)
    db.session.commit()
    return jsonify({"message": "Registered push token"})


@app.route('/api/groups', methods=['GET', 'POST'])
@token_required
def api_groups():
    if request.method == 'POST':
        data = request.get_json() or {}
        name = data.get('name')
        if not name:
            return jsonify({"error": "Name required"}), 400
        group = Group(name=name, kind='group')
        group.members.append(g.api_user)
        db.session.add(group)
        db.session.commit()
        return jsonify({"id": group.id, "name": _group_name_for_user(group, g.api_user)})

    groups = [{"id": grp.id, "name": _group_name_for_user(grp, g.api_user)} for grp in g.api_user.groups if grp.kind != 'album' or grp.kind is None]
    return jsonify({"groups": groups})


@app.route('/api/groups/<int:group_id>/posts', methods=['GET', 'POST'])
@token_required
def api_group_posts(group_id):
    group = Group.query.get_or_404(group_id)
    if group.kind == 'album':
        return jsonify({"error": "Use album endpoints for albums"}), 400
    if g.api_user not in group.members:
        return jsonify({"error": "Forbidden"}), 403

    if request.method == 'POST':
        return jsonify({"error": "Posts must be created in albums. Select one or more albums first."}), 400

    group_albums = Group.query.filter_by(kind='album', parent_group_id=group.id).all()
    album_ids = [a.id for a in group_albums]
    if album_ids:
        related_post_ids = db.session.query(PostAlbum.post_id).filter(PostAlbum.album_id.in_(album_ids))
        posts = Post.query.filter(or_(Post.id.in_(related_post_ids), Post.group_id == group.id)).order_by(Post.id.desc()).all()
    else:
        posts = Post.query.filter_by(group_id=group.id).order_by(Post.id.desc()).all()
    viewer_group_name = _group_name_for_user(group, g.api_user)
    return jsonify({
        "group": {"id": group.id, "name": viewer_group_name},
        "albums": [{"id": a.id, "name": a.name, "owner_id": a.owner_id} for a in group_albums],
        "posts": [_serialize_post(p, g.api_user, fallback_group_name=viewer_group_name) for p in posts]
    })


@app.route('/api/groups/<int:group_id>/posts/base64', methods=['POST'])
@token_required
def api_group_posts_base64(group_id):
    group = Group.query.get_or_404(group_id)
    if group.kind == 'album':
        return jsonify({"error": "Use album endpoints for albums"}), 400
    if g.api_user not in group.members:
        return jsonify({"error": "Forbidden"}), 403
    return jsonify({"error": "Posts must be created in albums. Select one or more albums first."}), 400


@app.route('/api/groups/<int:group_id>/update', methods=['POST'])
@token_required
def api_update_group(group_id):
    group = Group.query.get_or_404(group_id)
    if group.kind == 'album':
        return jsonify({"error": "Use album update endpoint"}), 400
    if g.api_user not in group.members:
        return jsonify({"error": "Forbidden"}), 403
    data = request.get_json() or {}
    new_name = (data.get('name') or '').strip()
    if not new_name:
        return jsonify({"error": "Name required"}), 400
    alias = GroupNameAlias.query.filter_by(group_id=group.id, user_id=g.api_user.id).first()
    if not alias:
        alias = GroupNameAlias(group_id=group.id, user_id=g.api_user.id, name=new_name)
        db.session.add(alias)
    else:
        alias.name = new_name
    db.session.commit()
    return jsonify({"group": {"id": group.id, "name": _group_name_for_user(group, g.api_user)}})


@app.route('/api/groups/<int:group_id>/members', methods=['GET', 'POST'])
@token_required
def api_add_group_member_api(group_id):
    group = Group.query.get_or_404(group_id)
    if group.kind == 'album':
        return jsonify({"error": "Use album members endpoint"}), 400
    if g.api_user not in group.members:
        return jsonify({"error": "Forbidden"}), 403
    if request.method == 'GET':
        members = [{
            "id": m.id,
            "username": m.username,
            "first_name": m.first_name,
            "last_name": m.last_name,
            "phone_number": m.phone_number,
        } for m in group.members]
        return jsonify({"members": members})
    data = request.get_json() or {}
    username = (data.get('username') or '').strip()
    phone_number = _normalize_phone_number(data.get('phone_number'))
    if not username and not phone_number:
        return jsonify({"error": "Username or phone number required"}), 400
    filters = []
    if username:
        filters.append(User.username == username)
    if phone_number:
        filters.append(User.phone_number == phone_number)
    user = User.query.filter(or_(*filters)).first()
    if not user:
        return jsonify({"error": "User not found"}), 404
    if user not in group.members:
        group.members.append(user)
        child_albums = Group.query.filter_by(kind='album', parent_group_id=group.id).all()
        for album in child_albums:
            if user not in album.members:
                album.members.append(user)
        db.session.commit()
    return jsonify({"message": "User added", "user": {"id": user.id, "username": user.username, "phone_number": user.phone_number}})


@app.route('/api/groups/<int:group_id>/albums', methods=['GET', 'POST'])
@token_required
def api_group_albums(group_id):
    group = Group.query.get_or_404(group_id)
    if group.kind == 'album':
        return jsonify({"error": "Not a group"}), 400
    if g.api_user not in group.members:
        return jsonify({"error": "Forbidden"}), 403
    if request.method == 'GET':
        albums = Group.query.filter_by(kind='album', parent_group_id=group.id).all()
        return jsonify({"albums": [{"id": a.id, "name": a.name, "owner_id": a.owner_id} for a in albums]})
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({"error": "Name required"}), 400
    album = Group(name=name, kind='album', owner_id=g.api_user.id, parent_group_id=group.id)
    for member in group.members:
        if member not in album.members:
            album.members.append(member)
    db.session.add(album)
    db.session.commit()
    return jsonify({"id": album.id, "name": album.name, "owner_id": album.owner_id, "parent_group_id": album.parent_group_id})


@app.route('/api/albums', methods=['GET', 'POST'])
@token_required
def api_albums():
    if request.method == 'POST':
        data = request.get_json() or {}
        name = (data.get('name') or '').strip()
        group_id = data.get('group_id')
        if not name:
            return jsonify({"error": "Name required"}), 400
        parent_group = None
        if group_id is not None:
            parent_group = Group.query.get(group_id)
            if not parent_group or parent_group.kind == 'album':
                return jsonify({"error": "Parent group not found"}), 404
            if g.api_user not in parent_group.members:
                return jsonify({"error": "Forbidden"}), 403
        album = Group(name=name, kind='album', owner_id=g.api_user.id, parent_group_id=parent_group.id if parent_group else None)
        if parent_group:
            for member in parent_group.members:
                if member not in album.members:
                    album.members.append(member)
        else:
            album.members.append(g.api_user)
        db.session.add(album)
        db.session.commit()
        return jsonify({"id": album.id, "name": album.name, "owner_id": album.owner_id, "parent_group_id": album.parent_group_id})

    albums = [{"id": grp.id, "name": grp.name, "owner_id": grp.owner_id, "parent_group_id": grp.parent_group_id} for grp in g.api_user.groups if grp.kind == 'album']
    return jsonify({"albums": albums})


@app.route('/api/albums/<int:album_id>/posts', methods=['GET', 'POST'])
@token_required
def api_album_posts(album_id):
    album = Group.query.get_or_404(album_id)
    if album.kind != 'album':
        return jsonify({"error": "Not an album"}), 400
    if g.api_user not in album.members:
        return jsonify({"error": "Forbidden"}), 403

    if request.method == 'POST':
        content = request.form.get('content') or (request.get_json() or {}).get('content')
        if not content:
            return jsonify({"error": "Content required"}), 400
        files = request.files.getlist('file')
        album_ids = _parse_album_ids(request.form.getlist('album_ids') or (request.get_json() or {}).get('album_ids'))
        target = _resolve_target_albums(album, g.api_user, album_ids)
        if target.get("error"):
            message = target["error"]
            code = 403 if message == "Forbidden" else 400
            return jsonify({"error": message}), code
        target_albums = target["albums"]
        if len(files) > MAX_MEDIA_PER_POST:
            return jsonify({"error": f"Too many files (max {MAX_MEDIA_PER_POST})."}), 400
        image_urls = store_files(files)
        post = Post(content=content, user_id=g.api_user.id, group_id=album.id, image_urls=','.join(image_urls))
        db.session.add(post)
        db.session.flush()
        _attach_post_to_albums(post, target_albums)
        db.session.commit()
        notify_album_members_post(target_albums, g.api_user, post)
        return jsonify({"message": "Created", "post_id": post.id})

    linked_post_ids = db.session.query(PostAlbum.post_id).filter_by(album_id=album.id)
    posts = Post.query.filter(or_(Post.id.in_(linked_post_ids), Post.group_id == album.id)).order_by(Post.id.desc()).all()
    return jsonify({
        "album": {"id": album.id, "name": album.name, "owner_id": album.owner_id, "parent_group_id": album.parent_group_id},
        "posts": [_serialize_post(p, g.api_user, fallback_group_name=album.name) for p in posts]
    })


@app.route('/api/albums/<int:album_id>/posts/base64', methods=['POST'])
@token_required
def api_album_posts_base64(album_id):
    album = Group.query.get_or_404(album_id)
    if album.kind != 'album':
        return jsonify({"error": "Not an album"}), 400
    if g.api_user not in album.members:
        return jsonify({"error": "Forbidden"}), 403
    data = request.get_json() or {}
    content = data.get('content')
    files = data.get('files') or []
    album_ids = _parse_album_ids(data.get('album_ids'))
    target = _resolve_target_albums(album, g.api_user, album_ids)
    if target.get("error"):
        message = target["error"]
        code = 403 if message == "Forbidden" else 400
        return jsonify({"error": message}), code
    target_albums = target["albums"]
    if not content:
        return jsonify({"error": "Content required"}), 400
    if not files:
        return jsonify({"error": "Files required"}), 400
    if len(files) > MAX_MEDIA_PER_POST:
        return jsonify({"error": f"Too many files (max {MAX_MEDIA_PER_POST})."}), 400
    image_urls = store_base64_files(files)
    if not image_urls:
        return jsonify({"error": "No valid files"}), 400
    post = Post(content=content, user_id=g.api_user.id, group_id=album.id, image_urls=','.join(image_urls))
    db.session.add(post)
    db.session.flush()
    _attach_post_to_albums(post, target_albums)
    db.session.commit()
    notify_album_members_post(target_albums, g.api_user, post)
    return jsonify({"message": "Created", "post_id": post.id})


@app.route('/api/albums/<int:album_id>/members', methods=['GET', 'POST'])
@token_required
def api_album_members(album_id):
    album = Group.query.get_or_404(album_id)
    if album.kind != 'album':
        return jsonify({"error": "Not an album"}), 400
    if g.api_user not in album.members:
        return jsonify({"error": "Forbidden"}), 403
    if request.method == 'GET':
        members = [{
            "id": m.id,
            "username": m.username,
            "first_name": m.first_name,
            "last_name": m.last_name,
            "phone_number": m.phone_number,
        } for m in album.members]
        return jsonify({"members": members, "owner_id": album.owner_id})
    data = request.get_json() or {}
    username = (data.get('username') or '').strip()
    phone_number = _normalize_phone_number(data.get('phone_number'))
    if not username and not phone_number:
        return jsonify({"error": "Username or phone number required"}), 400
    filters = []
    if username:
        filters.append(User.username == username)
    if phone_number:
        filters.append(User.phone_number == phone_number)
    user = User.query.filter(or_(*filters)).first()
    if not user:
        return jsonify({"error": "User not found"}), 404
    if user not in album.members:
        album.members.append(user)
        db.session.commit()
    return jsonify({"message": "User added", "user": {"id": user.id, "username": user.username, "phone_number": user.phone_number}})


@app.route('/api/albums/<int:album_id>/update', methods=['POST'])
@token_required
def api_update_album(album_id):
    album = Group.query.get_or_404(album_id)
    if album.kind != 'album':
        return jsonify({"error": "Not an album"}), 400
    if album.owner_id != g.api_user.id:
        return jsonify({"error": "Only the album owner can rename this album"}), 403
    data = request.get_json() or {}
    new_name = (data.get('name') or '').strip()
    if not new_name:
        return jsonify({"error": "Name required"}), 400
    album.name = new_name
    db.session.commit()
    return jsonify({"album": {"id": album.id, "name": album.name, "owner_id": album.owner_id}})


@app.route('/api/posts/<int:post_id>/like', methods=['POST'])
@token_required
def api_like_post(post_id):
    post = Post.query.get_or_404(post_id)
    post.likes += 1
    db.session.commit()
    notify_post_owner_like(g.api_user, post)
    return jsonify({"likes": post.likes})


@app.route('/api/posts/<int:post_id>/comment', methods=['POST'])
@token_required
def api_comment_post(post_id):
    content = request.form.get('comment') or (request.get_json() or {}).get('comment')
    if not content:
        return jsonify({"error": "Comment required"}), 400
    post = Post.query.get_or_404(post_id)
    comment = Comment(content=content, user_id=g.api_user.id, post=post)
    db.session.add(comment)
    db.session.commit()
    post_albums = _albums_for_post(post)
    if post_albums:
        seen_group_ids = set()
        for album in post_albums:
            if album.id in seen_group_ids:
                continue
            notify_group_members_comment(album, g.api_user, post, comment)
            seen_group_ids.add(album.id)
    else:
        group = Group.query.get(post.group_id)
        if group:
            notify_group_members_comment(group, g.api_user, post, comment)
    return jsonify({"message": "Comment added.", "comment": {"id": comment.id, "content": comment.content, "user": g.api_user.username, "user_id": g.api_user.id, "created_at": comment.created_at.isoformat() if comment.created_at else None}})


@app.route('/api/posts/<int:post_id>', methods=['DELETE'])
@token_required
def api_delete_post(post_id):
    post = Post.query.get_or_404(post_id)
    if post.user_id != g.api_user.id:
        return jsonify({"error": "Forbidden"}), 403
    PostAlbum.query.filter_by(post_id=post.id).delete()
    db.session.delete(post)
    db.session.commit()
    return jsonify({"message": "Post deleted"})


@app.route('/api/comments/<int:comment_id>', methods=['DELETE'])
@token_required
def api_delete_comment(comment_id):
    comment = Comment.query.get_or_404(comment_id)
    if comment.user_id != g.api_user.id:
        return jsonify({"error": "Forbidden"}), 403
    db.session.delete(comment)
    db.session.commit()
    return jsonify({"message": "Comment deleted", "comment_id": comment_id, "post_id": comment.post_id})


@app.route('/api/posts/<int:post_id>/media', methods=['POST'])
@token_required
def api_add_post_media(post_id):
    post = Post.query.get_or_404(post_id)
    if post.user_id != g.api_user.id:
        return jsonify({"error": "Forbidden"}), 403
    files = request.files.getlist('file')
    if not files:
        return jsonify({"error": "Files required"}), 400
    existing = _split_image_urls(post.image_urls)
    total_count = len(existing) + len(files)
    if total_count > MAX_MEDIA_PER_POST:
        return jsonify({"error": f"Too many files (max {MAX_MEDIA_PER_POST})."}), 400
    image_urls = store_files(files)
    post.image_urls = ','.join(existing + image_urls)
    db.session.commit()
    return jsonify({"message": "Attached", "image_urls": _resolve_image_urls(post.image_urls)})


@app.route('/api/posts/<int:post_id>/media/base64', methods=['POST'])
@token_required
def api_add_post_media_base64(post_id):
    post = Post.query.get_or_404(post_id)
    if post.user_id != g.api_user.id:
        return jsonify({"error": "Forbidden"}), 403
    data = request.get_json() or {}
    files = data.get('files') or []
    if not files:
        return jsonify({"error": "Files required"}), 400
    existing = _split_image_urls(post.image_urls)
    total_count = len(existing) + len(files)
    if total_count > MAX_MEDIA_PER_POST:
        return jsonify({"error": f"Too many files (max {MAX_MEDIA_PER_POST})."}), 400
    image_urls = store_base64_files(files)
    if not image_urls:
        return jsonify({"error": "No valid files"}), 400
    post.image_urls = ','.join(existing + image_urls)
    db.session.commit()
    return jsonify({"message": "Attached", "image_urls": _resolve_image_urls(post.image_urls)})

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        try:
            _ensure_schema_columns()
        except Exception as exc:
            print(f"[startup] failed to ensure schema columns: {exc}")
    app.run(debug=True)
