from flask import Flask, request, jsonify, session, redirect, url_for, render_template, send_from_directory, abort
from flask_sqlalchemy import SQLAlchemy
from flask_bcrypt import Bcrypt
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from werkzeug.utils import secure_filename
import os


from extensions.uploads import save_files, ALLOWED_EXTENSIONS, MAX_CONTENT_LENGTH
from extensions.s3_upload import upload_file_to_s3



app = Flask(__name__)
app.config['SECRET_KEY'] = 'supersecretkey'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///groupo.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = 'static/uploads'

bcrypt = Bcrypt(app)
db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login_page'

if not os.path.exists(app.config['UPLOAD_FOLDER']):
    os.makedirs(app.config['UPLOAD_FOLDER'])

class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password = db.Column(db.String(200), nullable=False)
    first_name = db.Column(db.String(100), nullable=False)
    last_name = db.Column(db.String(100), nullable=False)

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
    if request.method == 'POST':
        data = request.form
        hashed_pw = bcrypt.generate_password_hash(data['password']).decode('utf-8')
        user = User(
            username=data['username'],
            password=hashed_pw,
            first_name=data['first_name'],
            last_name=data['last_name']
        )
        db.session.add(user)
        db.session.commit()
        return redirect(url_for('login_page'))
    return render_template('register.html')


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
        data = request.form
        group = Group(name=data['name'])
        group.members.append(current_user)
        db.session.add(group)
        db.session.commit()
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
        image_urls = save_files(files, app.config['UPLOAD_FOLDER'])
        # image_urls = upload_file_to_s3(files)
        post = Post(content=content, user_id=current_user.id, group_id=group.id, image_urls=','.join(image_urls))
        db.session.add(post)
        db.session.commit()
        return redirect(url_for('group_posts', group_id=group_id))

    posts = Post.query.filter_by(group_id=group.id).all()
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

if __name__ == '__main__':
    if not os.path.exists('groupo.db'):
        with app.app_context():
            db.create_all()
    app.run(debug=True)
