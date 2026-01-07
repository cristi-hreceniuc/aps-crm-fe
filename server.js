// server.js
require('dotenv').config();

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const axios = require('axios');

const app = express();

/* ------------------------ Config ------------------------ */
const PORT = process.env.PORT || 3000;
const API_BASE = process.env.API_BASE || 'http://localhost:8080/api/v1'; // ex: http://localhost:8080/api/v1
const SESSION_SECRET = process.env.SESSION_SECRET || 'super-secret';
const isProd = process.env.NODE_ENV === 'production';

/* -------------------- Axios client BE ------------------- */
const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' }
});

/* --------------------- Middlewares ---------------------- */
if (!isProd) {
  // Live reload în dev (opțional)
  const connectLivereload = require('connect-livereload');
  const livereload = require('livereload');
  app.use(connectLivereload());
  const lrserver = livereload.createServer({
    exts: ['ejs', 'css', 'js', 'png', 'jpg', 'svg', 'webp'],
    delay: 200
  });
  lrserver.watch(path.join(__dirname, 'views'));
  lrserver.watch(path.join(__dirname, 'public'));
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(
  helmet({
    contentSecurityPolicy: false, // simplificat pt. dev/CDN-uri
  })
);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' }
  })
);

// helper mic de decodat exp fără biblioteci
function getJwtExpMs(token) {
  try {
    const part = token.split('.')[1];
    const json = JSON.parse(Buffer.from(part, 'base64').toString('utf8'));
    return json && json.exp ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

// Dacă JWT-ul e expirat -> distruge sesiunea.
// Pentru rutele /api/* răspunde JSON 401; pentru pagini, redirect la /login.
app.use((req, res, next) => {
  const t = req.session?.token;
  if (!t) return next();

  const expMs = getJwtExpMs(t);
  const skew = 30 * 1000; // 30s toleranță
  const isExpired = expMs && (Date.now() >= expMs - skew);

  if (!isExpired) return next();

  const isApi = req.path.startsWith('/api/');
  return req.session.destroy(() => {
    if (isApi) {
      res.status(401).json({ message: 'Session expired' });
    } else {
      res.redirect('/login?expired=1');
    }
  });
});

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', /* maxAge: 15*60*1000 */ },
  // rolling: true, // dacă vrei să prelungești sesiunea la fiecare request
}));


app.use(express.static(path.join(__dirname, 'public')));

/* Locals pt. view-uri */
app.use((req, res, next) => {
  res.locals.isLogged = !!req.session.token;
  res.locals.user = req.session.user || null;
  res.locals.path = req.path;
  next();
});

app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

function logoutOnUnauthorized(req, res, err) {
  const s = err?.response?.status;
  const msg = (err?.response?.data?.message || '').toLowerCase();
  if (s === 401 || s === 403 || msg.includes('expired') || msg.includes('invalid token')) {
    return req.session.destroy(() => {
      res.status(401).json({ message: 'Session expired' });
    });
  }
  return false;
}

// Translates common English error messages to Romanian
function translateErrorMessage(message) {
  if (!message || typeof message !== 'string') return message;
  
  const lowerMessage = message.toLowerCase();
  
  // Email already registered errors
  if (lowerMessage.includes('email already registered') ||
      lowerMessage.includes('email already exists') ||
      lowerMessage.includes('user already exists') ||
      lowerMessage.includes('email is already registered') ||
      lowerMessage.includes('email is already in use') ||
      (lowerMessage.includes('email') && lowerMessage.includes('already'))) {
    // Extract email if present in the message
    const emailMatch = message.match(/['"]([^'"]+@[^'"]+)['"]/);
    if (emailMatch) {
      return `Adresa de email '${emailMatch[1]}' este deja înregistrată.`;
    }
    return 'Adresa de email este deja înregistrată.';
  }
  
  // Bad credentials
  if (lowerMessage.includes('bad credentials') || 
      lowerMessage.includes('wrong credentials') ||
      lowerMessage.includes('invalid credentials') ||
      lowerMessage.includes('incorrect credentials')) {
    return 'Email sau parolă incorectă. Te rog verifică credențialele și încearcă din nou.';
  }
  
  // User not found
  if (lowerMessage.includes('user not found') || 
      lowerMessage.includes('email not found') ||
      lowerMessage.includes('account not found')) {
    return 'Email-ul nu a fost găsit. Te rog verifică adresa de email.';
  }
  
  // Password errors
  if (lowerMessage.includes('password') && lowerMessage.includes('incorrect')) {
    return 'Parolă incorectă. Te rog verifică parola și încearcă din nou.';
  }
  
  // Email format errors
  if (lowerMessage.includes('email') && lowerMessage.includes('incorrect')) {
    return 'Email incorect. Te rog verifică adresa de email.';
  }
  
  // Unauthorized
  if (lowerMessage.includes('unauthorized') || lowerMessage.includes('not authorized')) {
    return 'Nu ai permisiunea de a accesa această resursă.';
  }
  
  // Forbidden
  if (lowerMessage.includes('forbidden') || lowerMessage.includes('access denied')) {
    return 'Acces interzis. Te rog verifică permisiunile tale.';
  }
  
  // Not found
  if (lowerMessage.includes('not found') || lowerMessage.includes('404')) {
    return 'Resursa nu a fost găsită.';
  }
  
  // Data integrity violation
  if (lowerMessage.includes('data integrity violation')) {
    return 'Eroare la validarea datelor. Verifică că toate câmpurile sunt corecte.';
  }
  
  // Invalid role
  if (lowerMessage.includes('invalid user role') || lowerMessage.includes('invalid role')) {
    return 'Rol de utilizator invalid.';
  }
  
  // Password validation
  if (lowerMessage.includes('password') && (lowerMessage.includes('8') || lowerMessage.includes('min'))) {
    return 'Parola trebuie să aibă cel puțin 8 caractere.';
  }
  
  return message; // Return original if no translation found
}


/* ------------------------ Auth gate --------------------- */
function requireAuth(req, res, next) {
  if (req.session?.token) return next();
  req.session.afterLogin = req.originalUrl;
  return res.redirect('/login');
}

/* --------------------- Rute publice --------------------- */
app.get('/login', (req, res) => {
  if (req.session.token) return res.redirect('/');
  res.render('login', {
    title: 'Login',
    error: null,
    email: req.session.lastEmail || ''
  });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    // Send platform=WEB so ADMIN and VOLUNTEER can log in
    const { data } = await api.post('/auth/login', { email, password, platform: 'WEB' });
    if (!data?.token) throw new Error('Missing token from API');

    req.session.token = data.token;
    req.session.user = data.user || { email };
    req.session.lastEmail = email;

    const redirectTo = req.session.afterLogin || '/';
    delete req.session.afterLogin;
    return res.redirect(redirectTo);
  } catch (err) {
    req.session.lastEmail = email || '';
    const msg = err.response?.data?.message || err.message || 'Credențiale invalide';
    return res
      .status(401)
      .render('login', { title: 'Login', error: msg, email: req.session.lastEmail });
  }
});

app.get('/register', (req, res) => {
  if (!req.session.token) return res.redirect('/login'); // doar logați au voie
  res.render('register', { title: 'Înregistrare', message: null, error: null });
});

app.post('/register', async (req, res) => {
  const { email, password, firstName, lastName, gender } = req.body;
  try {
    // Default role for FE-created accounts is VOLUNTEER
    await api.post('/auth/register', { email, password, firstName, lastName, gender, userRole: 'VOLUNTEER' });
    res.render('register', {
      title: 'Înregistrare',
      message: 'Cont creat! Te poți autentifica.',
      error: null
    });
  } catch (err) {
    const data = err.response?.data;
    let msg = 'Eroare la crearea contului';
    
    if (data) {
      // RFC 7807 ProblemDetail format - check 'detail' field first
      if (data.detail) {
        msg = translateErrorMessage(data.detail);
      } else if (data.message) {
        msg = translateErrorMessage(data.message);
      } else if (data.title) {
        msg = translateErrorMessage(data.title);
      }
      
      // If there are field-specific validation errors, format them nicely
      if (data.errors && typeof data.errors === 'object') {
        const errorMessages = Object.entries(data.errors)
          .map(([field, message]) => {
            // Translate field names to Romanian
            const fieldNames = {
              email: 'Email',
              password: 'Parolă',
              firstName: 'Prenume',
              lastName: 'Nume',
              gender: 'Gen'
            };
            const fieldName = fieldNames[field] || field;
            // Translate the error message as well
            const translatedMessage = translateErrorMessage(String(message));
            return `${fieldName}: ${translatedMessage}`;
          })
          .join('; ');
        msg = errorMessages || msg;
      }
    }
    
    res.status(err.response?.status || 400).render('register', { 
      title: 'Înregistrare', 
      message: null, 
      error: msg 
    });
  }
});

app.use((req, res, next) => {
  res.locals.isLogged = !!req.session.token;   // true / false
  res.locals.user = req.session.user || null;  // dacă ai user salvat în sesiune
  next();
});


app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.set('Cache-Control', 'no-store');
    res.redirect('/login');
  });
});

/* --------- Gate: protejează TOT ce urmează (exceptând public) --------- */
/* exclude /login, /register, /favicon.ico; static e scos deja prin express.static */
app.use(/^\/(?!login|register|favicon\.ico).*/, requireAuth);

/* ------------------- Rute pagini (app) ------------------ */
app.get('/', (req, res) => res.render('home', { title: 'Direcționare 20%' }));
app.get('/voluntari', (req, res) => res.render('voluntari', { title: 'Voluntari', heading: 'Voluntari' }));
app.get('/d177', (req, res) => { res.render('d177', { title: 'Declarația 177', heading: 'Declarația 177' }); });
app.get('/sponsorizare', (req, res) => res.render('sponsorizare', { title: 'Contract sponsorizare', heading: 'Contract sponsorizare' }));
app.get('/rapoarte', (req, res) => res.render('rapoarte', { title: 'Rapoarte', heading: 'Rapoarte' }));
app.get('/setari', (req, res) => res.render('setari', { title: 'Setări', heading: 'Setări' }));
app.get('/offline-payments', (req, res) => res.render('offline-payments', { title: 'Plati offline' }));
app.get('/f230', requireAuth, (req, res) => res.render('f230', { title: 'Formular 230 – Formulare' }));
app.get('/iban-beneficiari', requireAuth, (req, res) => res.render('iban', { title: 'IBAN Beneficiari' }));
app.get('/cause', (req, res) => res.render('cause', { title: 'Cauze', heading: 'Cauze' }));
/* ----------------------- Proxy helper ------------------- */
// GET proxy spre Spring, pasează query-urile + Bearer din sesiune
const proxyGet = (targetPath) => async (req, res) => {
  if (!req.session?.token) return res.status(401).json({ message: 'Not authenticated' });

  // ✅ rezolvă path-ul dacă e funcție
  const path = (typeof targetPath === 'function') ? targetPath(req) : targetPath;

  try {
    const { data, status } = await api.get(path, {
      params: req.query,
      headers: { Authorization: `Bearer ${req.session.token}` }
    });
    return res.status(status).json(data);
  } catch (err) {
    if (logoutOnUnauthorized(req, res, err)) return; // 👈 adăugat
    const s = err.response?.status || 500;
    const body = err.response?.data || { message: 'Upstream error' };
    console.error('[proxyGet]', path, '->', s, body);   // ✅ log pe path-ul rezolvat
    return res.status(s).json(body);
  }
};

/* -------------------- Rute proxy API -------------------- */
/* Ambele rute FE mapează la același endpoint BE:
   - când q e gol => listă paginată normală
   - când q are text => căutare în câmpurile permise
*/
app.get('/api/voluntari', proxyGet('/volunteers/search'));
app.get('/api/voluntari/search', proxyGet('/volunteers/search'));

app.get('/api/d177', proxyGet('/formulare/d177/search'));
app.get('/api/d177/search', proxyGet('/formulare/d177/search')); // dacă vrei să păstrezi formatul grid-ului

app.get('/api/sponsorizare', proxyGet('/sponsorizare/search'));
app.get('/api/sponsorizare/search', proxyGet('/sponsorizare/search'));

app.get('/api/f230', proxyGet('/f230/search'));
app.get('/api/f230/search', proxyGet('/f230/search'));

app.get('/api/iban', proxyGet('/iban/search'));
app.get('/api/iban/search', proxyGet('/iban/search'));

app.get('/api/kpi', proxyGet('/kpi'));
app.get('/api/offline-payments', proxyGet('/offline-payments'));

app.get('/api/settings/xml', proxyGet('settings/xml'));

// Web users (ADMIN/VOLUNTEER) for settings page - Only show ADMIN and VOLUNTEER roles
app.get('/api/web-users', async (req, res) => {
  if (!req.session?.token) return res.status(401).json({ message: 'Not authenticated' });
  try {
    const { data, status } = await api.get('/users/web/search', {
      headers: { Authorization: `Bearer ${req.session.token}` },
      params: req.query
    });
    
    // Only show web users: ADMIN and VOLUNTEER
    if (data && data.content && Array.isArray(data.content)) {
      const allowedRoles = ['ADMIN', 'VOLUNTEER', 'ADMINISTRATOR'];
      data.content = data.content.filter(user => 
        allowedRoles.includes(user.role) || allowedRoles.includes(user.userRole)
      );
      // Update total count after filtering
      if (data.totalElements !== undefined) {
        data.totalElements = data.content.length;
      }
    }
    
    res.status(status).json(data);
  } catch (err) {
    if (logoutOnUnauthorized(req, res, err)) return;
    const s = err.response?.status || 500;
    res.status(s).json(err.response?.data || { message: 'Upstream error' });
  }
});
app.get('/api/web-users/search', async (req, res) => {
  if (!req.session?.token) return res.status(401).json({ message: 'Not authenticated' });
  try {
    const { data, status } = await api.get('/users/web/search', {
      headers: { Authorization: `Bearer ${req.session.token}` },
      params: req.query
    });
    
    // Only show web users: ADMIN and VOLUNTEER
    if (data && data.content && Array.isArray(data.content)) {
      const allowedRoles = ['ADMIN', 'VOLUNTEER', 'ADMINISTRATOR'];
      data.content = data.content.filter(user => 
        allowedRoles.includes(user.role) || allowedRoles.includes(user.userRole)
      );
      // Update total count after filtering
      if (data.totalElements !== undefined) {
        data.totalElements = data.content.length;
      }
    }
    
    res.status(status).json(data);
  } catch (err) {
    if (logoutOnUnauthorized(req, res, err)) return;
    const s = err.response?.status || 500;
    res.status(s).json(err.response?.data || { message: 'Upstream error' });
  }
});
/* === Proxy către BE (cu Bearer) === */

const proxyDelete = (targetPathBuilder) => async (req, res) => {
  if (!req.session?.token) return res.status(401).json({ message: 'Not authenticated' });
  const targetPath = (typeof targetPathBuilder === 'function') ? targetPathBuilder(req) : targetPathBuilder;
  try {
    const { status, data } = await api.delete(targetPath, {
      headers: { Authorization: `Bearer ${req.session.token}` }
    });
    return status === 204 ? res.status(204).end() : res.status(status).json(data);
  } catch (err) {
    if (logoutOnUnauthorized(req, res, err)) return; // 👈 adăugat
    const s = err.response?.status || 500;
    res.status(s).json(err.response?.data || { message: 'Upstream error' });
  }
};

// Generate XML borderou (F230)
app.post('/api/f230/borderou', requireAuth, async (req, res) => {
  try {
    const { token } = req.session;
    const { data, headers, status } = await api.post('/f230/borderou', req.body, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Accept': 'application/xml'
      },
      responseType: 'arraybuffer'  // pentru a forward-a fișierul
    });
    res.set('Content-Type', headers['content-type'] || 'application/xml');
    if (headers['content-disposition']) res.set('Content-Disposition', headers['content-disposition']);
    res.status(status || 200).send(data);
  } catch (e) {
    if (logoutOnUnauthorized(req, res, err)) return; // 👈 adăugat
    const s = e.response?.status || 500;
    res.status(s).json({ message: e.response?.data?.message || e.message });
  }
});


app.get('/api/reports/export', async (req, res) => {
  if (!req.session?.token) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
  try {
    const { dataset } = req.query;
    const response = await api.get(`/reports/export`, {
      params: { dataset },
      headers: { Authorization: `Bearer ${req.session.token}` },
      responseType: 'arraybuffer'   // <-- important
    });

    res.setHeader('Content-Disposition', `attachment; filename="${dataset}.csv"`);
    res.setHeader(
      'Content-Type',
      'text/csv; charset=UTF-8'
    );

    res.send(Buffer.from(response.data));   // trimite binar, nu .json()
  } catch (err) {
    if (logoutOnUnauthorized(req, res, err)) return; // 👈 adăugat
    console.error('Export proxy error:', err.message);
    res.status(err.response?.status || 500)
      .json(err.response?.data || { message: 'Upstream error at export' });
  }
});


const proxyPut = (pathBuilder) => async (req, res) => {
  if (!req.session?.token) return res.status(401).json({ message: 'Not authenticated' });
  const targetPath = (typeof pathBuilder === 'function') ? pathBuilder(req) : pathBuilder;
  try {
    const { status, data } = await api.put(targetPath, req.body, {
      headers: { Authorization: `Bearer ${req.session.token}` }
    });
    return res.status(status).json(data);
  } catch (err) {
    if (logoutOnUnauthorized(req, res, err)) return; // 👈 adăugat
    const s = err.response?.status || 500;
    return res.status(s).json(err.response?.data || { message: 'Upstream error' });
  }
};

const proxyPost = (pathBuilder) => async (req, res) => {
  if (!req.session?.token) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  const targetPath = (typeof pathBuilder === 'function') ? pathBuilder(req) : pathBuilder;

  try {
    const { status, data } = await api.post(targetPath, req.body, {
      headers: { Authorization: `Bearer ${req.session.token}` }
    });
    return res.status(status).json(data);
  } catch (err) {
    if (logoutOnUnauthorized(req, res, err)) return; // 👈 adăugat
    console.error('Proxy POST error:', err.message);
    const s = err.response?.status || 500;
    return res.status(s).json(err.response?.data || { message: 'Upstream error' });
  }
};
// --- PROXY API (trimite Bearer spre BE) ---
app.get('/api/cause', async (req, res) => {
  try {
    const { token } = req.session;
    const { data } = await api.get('/cause', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      params: req.query
    });
    res.json(data);
  } catch (err) {
    if (logoutOnUnauthorized(req, res, err)) return; // 👈 adăugat
    const status = err.response?.status || 500;
    res.status(status).json({ message: 'Proxy cause error' });
  }
});

// server.js (sau unde ai celelalte proxy-uri)
const ensureAuth = (req, res, next) => req.session?.token ? next() : res.status(401).json({ message: 'Not authenticated' });

// Middleware: Volunteer accounts cannot perform DELETE operations
const blockVolunteerDelete = (req, res, next) => {
  const userRole = req.session?.user?.userRole;
  if (userRole === 'VOLUNTEER') {
    return res.status(403).json({ message: 'Conturile de voluntar nu pot șterge înregistrări.' });
  }
  return next();
};

// list/search
app.get('/api/offline-payments', async (req, res) => {
  try {
    const { token } = req.session;
    const { data, status } = await api.get('/offline-payments', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      params: req.query
    });
    res.status(status).json(data);
  } catch (err) {
    if (logoutOnUnauthorized(req, res, err)) return; // 👈 adăugat
    res.status(err.response?.status || 500).json({ message: 'Proxy offline-payments error' });
  }
});

// update status
app.put('/api/offline-payments/:id/status', ensureAuth, async (req, res) => {
  try {
    const { token } = req.session;
    const { id } = req.params;
    const { data, status } = await api.put(`/offline-payments/${id}/status`, req.body, {
      headers: { Authorization: `Bearer ${token}` }
    });
    res.status(status).json(data);
  } catch (err) {
    if (logoutOnUnauthorized(req, res, err)) return; // 👈 adăugat
    res.status(err.response?.status || 500).json(err.response?.data || { message: 'Proxy update status error' });
  }
});

// delete
app.delete('/api/offline-payments/:id', ensureAuth, async (req, res) => {
  try {
    const { token } = req.session;
    const { id } = req.params;
    const { data, status } = await api.delete(`/offline-payments/${id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    res.status(status).json(data);
  } catch (err) {
    if (logoutOnUnauthorized(req, res, err)) return; // 👈 adăugat
    res.status(err.response?.status || 500).json({ message: 'Proxy delete offline-payment error' });
  }
});

// proxy download contract D177
app.get('/api/d177/:id/doc', async (req, res) => {
  if (!req.session?.token) return res.status(401).json({ message: 'Not authenticated' });
  try {
    // 1) ia detaliile de la BE ca să obții docUrl
    const { data } = await api.get(`/formulare/d177/${req.params.id}`, {
      headers: { Authorization: `Bearer ${req.session.token}` }
    });
    const url = (data && data.docUrl) ? String(data.docUrl) : null;
    if (!url) return res.status(404).json({ message: 'Nu există document' });

    const safeUrl = url.replace(/^http:/, 'https:'); // evită mixed-content
    const filename = (safeUrl.split('/').pop() || `contract_${req.params.id}`).replace(/[^\w.\-]+/g, '_');

    // 2) adu fișierul de la WP și streamează-l către client
    const fileResp = await axios.get(safeUrl, { responseType: 'arraybuffer' });
    res.setHeader('Content-Type', fileResp.headers['content-type'] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Filename', filename);
    return res.send(Buffer.from(fileResp.data));
  } catch (err) {
    if (logoutOnUnauthorized(req, res, err)) return; // 👈 adăugat
    const s = err.response?.status || 500;
    console.error('[proxy d177 doc]', s, err.response?.data || err.message);
    return res.status(s).json({ message: 'Upstream error' });
  }
});


app.get('/api/f230/:id', proxyGet(req => `/f230/${req.params.id}`));
app.get('/api/formulare/d177/:id', proxyGet(req => `/formulare/d177/${req.params.id}`));
app.get('/api/d177/:id', proxyGet(req => `/formulare/d177/${req.params.id}`));
app.get('/api/voluntari/:id', proxyGet(req => `/volunteers/${req.params.id}`));
app.get('/api/sponsorizare/:id', proxyGet(req => `/sponsorizare/${req.params.id}`));

// rutele proxy (unde ai și GET-urile):
// All DELETE routes are protected - VOLUNTEER accounts cannot delete anything
app.delete('/api/voluntari/:id', blockVolunteerDelete, proxyDelete(req => `/volunteers/${req.params.id}`));
app.delete('/api/d177/:id', blockVolunteerDelete, proxyDelete(req => `/formulare/d177/${req.params.id}`));
app.delete('/api/f230/:id', blockVolunteerDelete, proxyDelete(req => `/f230/${req.params.id}`));
app.delete('/api/iban/:id', blockVolunteerDelete, proxyDelete(req => `/iban/${req.params.id}`));
app.delete('/api/offline-payments/:id', blockVolunteerDelete, proxyDelete(req => `/offline-payments/${req.params.id}`));
app.delete('/api/sponsorizare/:id', blockVolunteerDelete, proxyDelete(req => `/sponsorizare/${req.params.id}`));
// Only ADMIN can delete web users, and ADMIN accounts cannot be deleted
app.delete('/api/web-users/:id', async (req, res, next) => {
  const userRole = req.session?.user?.userRole;
  if (userRole !== 'ADMIN') {
    return res.status(403).json({ message: 'Doar administratorii pot șterge conturi.' });
  }
  
  // Check if the target user is an ADMIN - ADMIN accounts cannot be deleted
  try {
    const { data: targetUser } = await api.get(`/users/${req.params.id}`, {
      headers: { Authorization: `Bearer ${req.session.token}` }
    });
    if (targetUser && (targetUser.userRole === 'ADMIN' || targetUser.role === 'ADMIN')) {
      return res.status(403).json({ message: 'Conturile de administrator nu pot fi șterse.' });
    }
  } catch (err) {
    // If we can't fetch the user, let the delete proceed and fail naturally if needed
    console.error('Error checking target user role:', err.message);
  }
  
  return proxyDelete(r => `/users/${r.params.id}`)(req, res, next);
});
app.delete('/api/settings/:id', blockVolunteerDelete, proxyDelete(req => `/settings/${req.params.id}`));

app.put('/api/d177/:id/flags', proxyPut(req => `/formulare/d177/${req.params.id}/flags`));
app.put('/api/f230/:id/flags', proxyPut(req => `/f230/${req.params.id}/flags`));
app.put('/api/sponsorizare/:id/flags', proxyPut(req => `/sponsorizare/${req.params.id}/flags`));
app.put('/api/offline-payments/:id/status', proxyPut(req => `/offline-payments/${req.params.id}/status`));
app.put('/api/settings/:id', proxyPut(req => `/settings/${req.params.id}`));
app.put('/api/iban/:id/hide', proxyPut(req => `/iban/${req.params.id}/hide`));

app.post('/api/settings/:id/reset', proxyPost(req => `/settings/${req.params.id}/reset`));
app.post('/api/f230/borderou', proxyPost('/f230/borderou'));

function normalizeIbanNode(s) { return String(s || '').replace(/\s+/g, '').toUpperCase(); }
function ibanMod97Node(iban) {
  const s = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of s) {
    const val = (ch >= 'A' && ch <= 'Z') ? (ch.charCodeAt(0) - 55) : Number(ch);
    rem = Number(String(rem) + String(val)) % 97;
  }
  return rem;
}
function isValidIbanNode(iban) {
  const x = normalizeIbanNode(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(x)) return false;
  const lengths = { RO: 24, /* …completezi dacă vrei */ };
  const L = lengths[x.slice(0, 2)];
  if (L && x.length !== L) return false;
  return ibanMod97Node(x) === 1;
}

app.post('/api/iban', (req, res, next) => {
  const { iban } = req.body || {};
  if (!isValidIbanNode(iban)) {
    return res.status(400).json({ message: 'IBAN invalid' });
  }
  // normalizează ca să fie salvat consistent
  req.body.iban = normalizeIbanNode(iban);
  return proxyPost('/iban')(req, res);
});

app.put('/api/iban/:id', ensureAuth, async (req, res) => {
  try {
    const { token } = req.session;
    const { id } = req.params;

    let { name, iban } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ message: 'Numele beneficiarului este obligatoriu.' });
    }
    iban = normalizeIban(iban);
    if (!isValidIban(iban)) {
      return res.status(400).json({ message: 'IBAN invalid.' });
    }

    const { status, data } = await api.put(`/iban/${encodeURIComponent(id)}`, {
      name: name.trim(),
      iban
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });

    return res.status(status).json(data);
  } catch (err) {
    const s = err.response?.status || 500;
    return res.status(s).json(err.response?.data || { message: 'Upstream error' });
  }
});

// Only ADMIN users can access the logopedy app management page
app.get('/aplicatie-logopedica', (req, res) => {
  const userRole = req.session?.user?.userRole;
  if (userRole !== 'ADMIN') {
    return res.status(403).render('404', { 
      title: 'Acces interzis',
      message: 'Doar administratorii pot accesa această pagină.'
    });
  }
  res.render('logopedie', { title: 'Aplicație Logopedică', heading: 'Aplicație Logopedică' });
});

// LIST / SEARCH - Only show SPECIALIST, SPECIALIST_BUNDLE, and USER users (mobile app users)
app.get('/api/logopedie/users', async (req,res)=>{
  if (!req.session?.token) return res.status(401).json({ message:'Not authenticated' });
  try {
    const { data, status } = await api.get('/users/search', {
      headers: { Authorization: `Bearer ${req.session.token}` },
      params: req.query
    });
    
    // Only show mobile app users: SPECIALIST, SPECIALIST_BUNDLE, USER (which includes PREMIUM users based on isPremium flag)
    if (data && data.content && Array.isArray(data.content)) {
      const allowedRoles = ['SPECIALIST', 'SPECIALIST_BUNDLE', 'USER'];
      data.content = data.content.filter(user => allowedRoles.includes(user.role));
      // Update total count after filtering
      if (data.totalElements !== undefined) {
        data.totalElements = data.content.length;
      }
    }
    
    res.status(status).json(data);
  } catch (err) {
    const s = err.response?.status || 500;
    res.status(s).json(err.response?.data || { message:'Upstream error' });
  }
});

// UPDATE STATUS
app.put('/api/logopedie/users/:id/status', ensureAuth, async (req,res)=>{
  try{
    const { token } = req.session;
    const { id } = req.params;
    const { status } = req.body || {};
    if (!['PENDING','ACTIVE','INACTIVE'].includes(String(status || '').toUpperCase()))
      return res.status(400).json({ message:'Status invalid' });

    const { status:code } = await api.put(`/users/${encodeURIComponent(id)}/status`,
      { status: String(status).toUpperCase() },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    res.status(code).end();
  }catch(err){
    res.status(err.response?.status||500).json(err.response?.data||{message:'Upstream error'});
  }
});

// TOGGLE PREMIUM
app.put('/api/logopedie/users/:id/premium', ensureAuth, async (req,res)=>{
  try{
    const { token } = req.session;
    const { id } = req.params;
    const premium = !!req.body?.premium;
    const { status:code } = await api.put(`/users/${encodeURIComponent(id)}/premium`,
      { premium }, { headers: { Authorization: `Bearer ${token}` } });
    res.status(code).end();
  }catch(err){
    res.status(err.response?.status||500).json(err.response?.data||{message:'Upstream error'});
  }
});

// DELETE - protected: VOLUNTEER accounts cannot delete
app.delete('/api/logopedie/users/:id', ensureAuth, blockVolunteerDelete, async (req,res)=>{
  try{
    const { token } = req.session;
    const { id } = req.params;
    const { status:code } = await api.delete(`/users/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    res.status(code).end();
  }catch(err){
    res.status(err.response?.status||500).json(err.response?.data||{message:'Upstream error'});
  }
});

// NOTIFICATIONS - Send targeted notification
app.post('/api/logopedie/notifications/targeted', ensureAuth, async (req, res) => {
  try {
    const { token } = req.session;
    const { status, data } = await api.post('/admin/notifications/targeted', req.body, {
      headers: { Authorization: `Bearer ${token}` }
    });
    res.status(status).json(data);
  } catch (err) {
    if (logoutOnUnauthorized(req, res, err)) return;
    const s = err.response?.status || 500;
    res.status(s).json(err.response?.data || { message: 'Upstream error' });
  }
});

// GET require_active_for_login setting
app.get('/api/logopedie/require-active-for-login', ensureAuth, async (req, res) => {
  try {
    const { token } = req.session;
    const { status, data } = await api.get('/settings/require-active-for-login', {
      headers: { Authorization: `Bearer ${token}` }
    });
    res.status(status).json(data);
  } catch (err) {
    if (logoutOnUnauthorized(req, res, err)) return;
    const s = err.response?.status || 500;
    res.status(s).json(err.response?.data || { message: 'Upstream error' });
  }
});

// PUT require_active_for_login setting (admin only)
app.put('/api/logopedie/require-active-for-login', ensureAuth, async (req, res) => {
  const userRole = req.session?.user?.userRole;
  if (userRole !== 'ADMIN') {
    return res.status(403).json({ message: 'Doar administratorii pot modifica această setare.' });
  }
  try {
    const { token } = req.session;
    const { status, data } = await api.put('/settings/require-active-for-login', req.body, {
      headers: { Authorization: `Bearer ${token}` }
    });
    res.status(status).json(data);
  } catch (err) {
    if (logoutOnUnauthorized(req, res, err)) return;
    const s = err.response?.status || 500;
    res.status(s).json(err.response?.data || { message: 'Upstream error' });
  }
});

// ============== BUNDLE MANAGEMENT (Admin Only) ==============

// List all bundles
app.get('/api/logopedie/bundles', ensureAuth, async (req, res) => {
  const userRole = req.session?.user?.userRole;
  if (userRole !== 'ADMIN') {
    return res.status(403).json({ message: 'Doar administratorii pot accesa bundle-urile.' });
  }
  try {
    const { token } = req.session;
    const { status, data } = await api.get('/admin/bundles', {
      headers: { Authorization: `Bearer ${token}` }
    });
    res.status(status).json(data);
  } catch (err) {
    if (logoutOnUnauthorized(req, res, err)) return;
    const s = err.response?.status || 500;
    res.status(s).json(err.response?.data || { message: 'Upstream error' });
  }
});

// Get bundle detail
app.get('/api/logopedie/bundles/:specialistId', ensureAuth, async (req, res) => {
  const userRole = req.session?.user?.userRole;
  if (userRole !== 'ADMIN') {
    return res.status(403).json({ message: 'Doar administratorii pot accesa bundle-urile.' });
  }
  try {
    const { token } = req.session;
    const { specialistId } = req.params;
    const { status, data } = await api.get(`/admin/bundles/${encodeURIComponent(specialistId)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    res.status(status).json(data);
  } catch (err) {
    if (logoutOnUnauthorized(req, res, err)) return;
    const s = err.response?.status || 500;
    res.status(s).json(err.response?.data || { message: 'Upstream error' });
  }
});

// Assign bundle to specialist
app.post('/api/logopedie/bundles', ensureAuth, async (req, res) => {
  const userRole = req.session?.user?.userRole;
  if (userRole !== 'ADMIN') {
    return res.status(403).json({ message: 'Doar administratorii pot adăuga bundle-uri.' });
  }
  try {
    const { token } = req.session;
    const { status, data } = await api.post('/admin/bundles', req.body, {
      headers: { Authorization: `Bearer ${token}` }
    });
    res.status(status).json(data);
  } catch (err) {
    if (logoutOnUnauthorized(req, res, err)) return;
    const s = err.response?.status || 500;
    res.status(s).json(err.response?.data || { message: 'Upstream error' });
  }
});

// Toggle premium for bundle specialist
app.put('/api/logopedie/bundles/:specialistId/premium', ensureAuth, async (req, res) => {
  const userRole = req.session?.user?.userRole;
  if (userRole !== 'ADMIN') {
    return res.status(403).json({ message: 'Doar administratorii pot modifica bundle-urile.' });
  }
  try {
    const { token } = req.session;
    const { specialistId } = req.params;
    const { status, data } = await api.put(`/admin/bundles/${encodeURIComponent(specialistId)}/premium`, req.body, {
      headers: { Authorization: `Bearer ${token}` }
    });
    res.status(status).json(data);
  } catch (err) {
    if (logoutOnUnauthorized(req, res, err)) return;
    const s = err.response?.status || 500;
    res.status(s).json(err.response?.data || { message: 'Upstream error' });
  }
});

// Revoke bundle
app.delete('/api/logopedie/bundles/:specialistId', ensureAuth, async (req, res) => {
  const userRole = req.session?.user?.userRole;
  if (userRole !== 'ADMIN') {
    return res.status(403).json({ message: 'Doar administratorii pot revoca bundle-uri.' });
  }
  try {
    const { token } = req.session;
    const { specialistId } = req.params;
    const { status } = await api.delete(`/admin/bundles/${encodeURIComponent(specialistId)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    res.status(status).end();
  } catch (err) {
    if (logoutOnUnauthorized(req, res, err)) return;
    const s = err.response?.status || 500;
    res.status(s).json(err.response?.data || { message: 'Upstream error' });
  }
});

// Search specialists (only SPECIALIST role, not SPECIALIST_BUNDLE)
app.get('/api/logopedie/specialists/search', ensureAuth, async (req, res) => {
  const userRole = req.session?.user?.userRole;
  if (userRole !== 'ADMIN') {
    return res.status(403).json({ message: 'Doar administratorii pot căuta specialiști.' });
  }
  try {
    const { token } = req.session;
    const { q } = req.query;
    
    // Search users with SPECIALIST role
    const { data } = await api.get('/users/search', {
      headers: { Authorization: `Bearer ${token}` },
      params: { q, size: 20 }
    });
    
    // Filter to only SPECIALIST role (not SPECIALIST_BUNDLE)
    const specialists = (data.content || [])
      .filter(u => u.role === 'SPECIALIST')
      .map(u => ({
        id: u.id,
        name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email,
        email: u.email
      }));
    
    res.json(specialists);
  } catch (err) {
    if (logoutOnUnauthorized(req, res, err)) return;
    const s = err.response?.status || 500;
    res.status(s).json(err.response?.data || { message: 'Upstream error' });
  }
});


/* ------------------------- 404 handler ------------------------- */
app.use((req, res) => {
  res.status(404).render('404', { title: '404' });
});

/* -------------------------- Start app -------------------------- */
app.listen(PORT, () => {
  console.log(`FE running on http://localhost:${PORT}`);
  console.log(`Proxy to BE: ${API_BASE}`);
});

