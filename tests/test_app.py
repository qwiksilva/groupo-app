# test_app.py
import pytest
from app import app, db, User, Group, Post
from flask import url_for

@pytest.fixture
def client():
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
    with app.test_client() as client:
        with app.app_context():
            db.create_all()
            # Setup demo data
            user = User(username='tester', password='testpass')
            db.session.add(user)
            db.session.commit()
        yield client


def test_home_page(client):
    rv = client.get('/')
    assert b'Welcome' in rv.data


def test_register_and_login(client):
    # Register
    rv = client.post('/register', json={'username': 'newuser', 'password': 'newpass'})
    assert b'User registered' in rv.data

    # Login
    rv = client.post('/login', json={'username': 'newuser', 'password': 'newpass'})
    assert b'Logged in' in rv.data


def test_create_group(client):
    client.post('/register', json={'username': 'grpuser', 'password': 'grppass'})
    client.post('/login', json={'username': 'grpuser', 'password': 'grppass'})
    rv = client.post('/groups', json={'name': 'TestGroup'})
    assert b'Group created' in rv.data