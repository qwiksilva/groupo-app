from app import db, app, User, Group, Post, Comment, GroupMembers
import os

with app.app_context():
    db.drop_all()
    db.create_all()

    # Optional: seed with one user and group for testing
    user = User(username='testuser', password='test', first_name='Test', last_name='User')
    db.session.add(user)
    db.session.commit()

    group = Group(name='Test Group')
    group.members.append(user)
    db.session.add(group)
    db.session.commit()

    print("Database schema reset and test data added.")