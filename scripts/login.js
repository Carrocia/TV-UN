import { api } from './api.js';

const $ = selector => document.querySelector(selector);
const form = $('#loginForm');
const submit = $('#submitButton');
const message = $('#formMessage');

async function initialize() {
  try {
    const { session } = await api.getSession();
    if (session) location.replace('./');
  } catch (error) {
    message.textContent = error.message;
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  message.textContent = '';
  submit.disabled = true;
  try {
    await api.signIn($('#email').value.trim(), $('#password').value);
    location.replace('./');
  } catch (error) {
    message.textContent = error.message || 'Não foi possível entrar. Confira seu e-mail e senha.';
    submit.disabled = false;
  }
});

initialize();
