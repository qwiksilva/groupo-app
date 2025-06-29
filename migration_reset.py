from app import db, app, User, Group, Post, Comment, GroupMembers
from flask_bcrypt import Bcrypt
import os

bcrypt = Bcrypt(app)

with app.app_context():
    db.drop_all()
    db.create_all()

    passw = os.environ['GROUPO_PASSWORD']

    pw = bcrypt.generate_password_hash(passw).decode('utf-8')

    username = os.environ['GROUPO_USER1']
    user = User(username=username.split()[0], password=pw, first_name=username.split()[0], last_name=username.split()[1])
    db.session.add(user)

    username = os.environ['GROUPO_USER2']
    user = User(username=username.split()[0], password=pw, first_name=username.split()[0], last_name=username.split()[1])
    db.session.add(user)

    # username = os.environ['GROUPO_USER3']
    # user = User(username=username.split()[0], password=pw, first_name=username.split()[0], last_name=username.split()[1])
    # db.session.add(user)
    #
    # username = os.environ['GROUPO_USER4']
    # user = User(username=username.split()[0], password=pw, first_name=username.split()[0], last_name=username.split()[1])
    # db.session.add(user)
    #
    # username = os.environ['GROUPO_USER5']
    # user = User(username=username.split()[0], password=pw, first_name=username.split()[0], last_name=username.split()[1])
    # db.session.add(user)
    #
    # username = os.environ['GROUPO_USER6']
    # user = User(username=username.split()[0], password=pw, first_name=username.split()[0], last_name=username.split()[1])
    # db.session.add(user)

    db.session.commit()

    print("Database schema reset and test data added.")