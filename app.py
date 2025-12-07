from flask import Flask, request, jsonify, session, redirect, url_for, render_template, send_from_directory, abort, g
from flask_sqlalchemy import SQLAlchemy
from flask_bcrypt import Bcrypt
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from functools import wraps
import os
import secrets
import requests


from extensions.uploads import save_files, ALLOWED_EXTENSIONS, MAX_CONTENT_LENGTH
from extensions.s3_upload import upload_file_to_s3



app = Flask(__name__)
app.config['SECRET_KEY'] = 'supersecretkey'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///groupo.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = 'static/uploads'
USE_S3 = os.environ.get('RENDER') == 'true'

bcrypt = Bcrypt(app)
db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login_page'

if os.environ.get('RENDER') == 'true':
    with app.app_context():
        db.create_all()

if not os.path.exists(app.config['UPLOAD_FOLDER']):
    os.makedirs(app.config['UPLOAD_FOLDER'])

class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password = db.Column(db.String(200), nullable=False)
    first_name = db.Column(db.String(100), nullable=False)
    last_name = db.Column(db.String(100), nullable=False)
    api_token = db.Column(db.String(128), unique=True)

class Group(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    members = db.relationship('User', secondary='group_members', backref='groups')

class Post(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.Text, nullable=False)
    image_urls = db.Column(db.Text)  # Comma-separated URLs
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    group_id = db.Column(db.Integer, db.ForeignKey('group.id'), nullable=False)
    likes = db.Column(db.Integer, default=0)
    comments = db.relationship('Comment', backref='post', cascade="all, delete-orphan")
    user = db.relationship('User')

class Comment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.String(300), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    post_id = db.Column(db.Integer, db.ForeignKey('post.id'), nullable=False)
    user = db.relationship('User')

class GroupMembers(db.Model):
    __tablename__ = 'group_members'
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), primary_key=True)
    group_id = db.Column(db.Integer, db.ForeignKey('group.id'), primary_key=True)

friends = db.Table('friends',
    db.Column('user_id', db.Integer, db.ForeignKey('user.id')),
    db.Column('friend_id', db.Integer, db.ForeignKey('user.id'))
)


def store_files(files):
    """Save uploads locally or to S3 depending on environment."""
    if USE_S3:
        try:
            return upload_file_to_s3(files)
        except Exception as exc:
            print(f"[upload] S3 upload failed, falling back to local: {exc}")
    return save_files(files, app.config['UPLOAD_FOLDER'])

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
        image_urls = store_files(files)
        post = Post(content=content, user_id=current_user.id, group_id=group.id, image_urls=','.join(image_urls))
        db.session.add(post)
        db.session.commit()
        return redirect(url_for('group_posts', group_id=group_id))

    posts = Post.query.filter_by(group_id=group.id).order_by(Post.id.desc()).all()
    return render_template('group_posts.html', group=group, posts=posts)

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


@app.route('/api/register', methods=['POST'])
def api_register():
    data = request.get_json() or {}
    required = ['username', 'password', 'first_name', 'last_name']
    if not all(k in data for k in required):
        return jsonify({"error": "Missing fields"}), 400
    if User.query.filter_by(username=data['username']).first():
        return jsonify({"error": "Username taken"}), 400
    hashed_pw = bcrypt.generate_password_hash(data['password']).decode('utf-8')
    user = User(
        username=data['username'],
        password=hashed_pw,
        first_name=data['first_name'],
        last_name=data['last_name'],
        api_token=generate_api_token()
    )
    db.session.add(user)
    db.session.commit()
    return jsonify({"token": user.api_token, "user": {"id": user.id, "username": user.username}})


@app.route('/api/login', methods=['POST'])
def api_login():
    data = request.get_json() or {}
    user = User.query.filter_by(username=data.get('username')).first()
    if not user or not bcrypt.check_password_hash(user.password, data.get('password', '')):
        return jsonify({"error": "Invalid credentials"}), 401
    if not user.api_token:
        user.api_token = generate_api_token()
    db.session.commit()
    return jsonify({"token": user.api_token, "user": {"id": user.id, "username": user.username}})


@app.route('/api/push/register', methods=['POST'])
@token_required
def api_register_push():
    data = request.get_json() or {}
    token = data.get('token')
    platform = data.get('platform', 'ios')
    if not token:
        return jsonify({"error": "Missing token"}), 400
    existing = DeviceToken.query.filter_by(user_id=g.api_user.id, token=token).first()
    if not existing:
        dt = DeviceToken(user_id=g.api_user.id, token=token, platform=platform)
        db.session.add(dt)
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
        group = Group(name=name)
        group.members.append(g.api_user)
        db.session.add(group)
        db.session.commit()
        return jsonify({"id": group.id, "name": group.name})

    groups = [{"id": grp.id, "name": grp.name} for grp in g.api_user.groups]
    return jsonify({"groups": groups})


@app.route('/api/groups/<int:group_id>/posts', methods=['GET', 'POST'])
@token_required
def api_group_posts(group_id):
    group = Group.query.get_or_404(group_id)
    if g.api_user not in group.members:
        return jsonify({"error": "Forbidden"}), 403

    if request.method == 'POST':
        content = request.form.get('content') or (request.get_json() or {}).get('content')
        if not content:
            return jsonify({"error": "Content required"}), 400
        files = request.files.getlist('file')
        image_urls = store_files(files)
        post = Post(content=content, user_id=g.api_user.id, group_id=group.id, image_urls=','.join(image_urls))
        db.session.add(post)
        db.session.commit()
        notify_group_members(group, g.api_user, post)
        return jsonify({"message": "Created", "post_id": post.id})

    posts = Post.query.filter_by(group_id=group.id).order_by(Post.id.desc()).all()
    return jsonify({
        "group": {"id": group.id, "name": group.name},
        "posts": [{
            "id": p.id,
            "content": p.content,
            "image_urls": p.image_urls.split(',') if p.image_urls else [],
            "user": p.user.username,
            "likes": p.likes,
            "group_id": group.id,
            "group_name": group.name,
            "comments": [{"id": c.id, "content": c.content, "user": c.user.username} for c in p.comments]
        } for p in posts]
    })


@app.route('/api/groups/<int:group_id>/update', methods=['POST'])
@token_required
def api_update_group(group_id):
    group = Group.query.get_or_404(group_id)
    if g.api_user not in group.members:
        return jsonify({"error": "Forbidden"}), 403
    data = request.get_json() or {}
    new_name = data.get('name')
    if new_name:
        group.name = new_name
        db.session.commit()
    return jsonify({"group": {"id": group.id, "name": group.name}})


@app.route('/api/groups/<int:group_id>/members', methods=['POST'])
@token_required
def api_add_group_member_api(group_id):
    group = Group.query.get_or_404(group_id)
    if g.api_user not in group.members:
        return jsonify({"error": "Forbidden"}), 403
    data = request.get_json() or {}
    username = data.get('username')
    if not username:
        return jsonify({"error": "Username required"}), 400
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({"error": "User not found"}), 404
    if user not in group.members:
        group.members.append(user)
        db.session.commit()
    return jsonify({"message": "User added", "user": {"id": user.id, "username": user.username}})


@app.route('/api/posts/<int:post_id>/like', methods=['POST'])
@token_required
def api_like_post(post_id):
    post = Post.query.get_or_404(post_id)
    post.likes += 1
    db.session.commit()
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
    return jsonify({"message": "Comment added.", "comment": {"id": comment.id, "content": comment.content, "user": g.api_user.username}})

if __name__ == '__main__':
    if not os.path.exists('groupo.db'):
        with app.app_context():
            db.create_all()
    app.run(debug=True)
