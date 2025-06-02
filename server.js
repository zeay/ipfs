// scaled-ipfs-platform.mjs
import express from 'express';
import { exec, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import util from 'util';
const execAsync = util.promisify(exec);
import cors from 'cors';
import crypto from 'crypto';
import multer from 'multer';
import AdmZip from 'adm-zip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

let ipfsDaemon = null;

// Enhanced mapping systems
let dns_map = {};           // dns => { cid, owner, created, updated, type }
let user_directories = {};  // userId => { dns: [], files: { filename: cid } }
let cid_history = {};       // dns => [{ cid, timestamp, version }]
let file_ownership = {};    // filename => userId
let access_tokens = {};     // token => { userId, permissions, expires }

// Persistent storage
const DATA_FILE = path.join(__dirname, 'platform-data.json');

// ========== Data Persistence ==========
function saveData() {
  const data = {
    dns_map,
    user_directories,
    cid_history,
    file_ownership,
    access_tokens,
    timestamp: new Date().toISOString()
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE));
      dns_map = data.dns_map || {};
      user_directories = data.user_directories || {};
      cid_history = data.cid_history || {};
      file_ownership = data.file_ownership || {};
      access_tokens = data.access_tokens || {};
      console.log('📊 Data loaded from storage');
    }
  } catch (err) {
    console.error('❌ Failed to load data:', err.message);
  }
}

// ========== Helper Functions ==========
function generateUserId() {
  return crypto.randomBytes(16).toString('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function execPromise(command, cwd = undefined) {
  return new Promise((resolve, reject) => {
    exec(command, { cwd }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

async function getIPFSTree(cid, depth = 0, maxDepth = 10) {
  if (depth > maxDepth) return cid;
  
  const tree = {};
  try {
    const result = await execAsync(`ipfs ls ${cid}`);
    const lines = result.stdout.trim().split('\n');
    
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;
      
      const fileCID = parts[0];
      const fileName = parts[2];
      
      try {
        const subTree = await getIPFSTree(fileCID, depth + 1, maxDepth);
        tree[fileName] = subTree;
      } catch (err) {
        tree[fileName] = fileCID;
      }
    }
    return tree;
  } catch (err) {
    return cid;
  }
}

function startIPFS() {
  return new Promise((resolve, reject) => {
    console.log("🧹 Running: ipfs repo gc");
    exec("ipfs repo gc", (gcErr) => {
      if (gcErr) console.warn("⚠️ GC warning:", gcErr.message);
      
      console.log("🚀 Starting IPFS daemon...");
      ipfsDaemon = spawn("ipfs", ["daemon"]);
      
      let started = false;
      ipfsDaemon.stdout.on('data', data => {
        const output = data.toString();
        console.log(`📡 IPFS: ${output}`);
        if (output.includes('Daemon is ready') && !started) {
          started = true;
          resolve();
        }
      });
      
      ipfsDaemon.stderr.on('data', data => {
        console.error(`❌ IPFS ERR: ${data.toString()}`);
      });
      
      // Fallback timeout
      setTimeout(() => {
        if (!started) {
          started = true;
          resolve();
        }
      }, 5000);
    });
  });
}

function stopIPFS() {
  return new Promise(resolve => {
    if (ipfsDaemon) {
      ipfsDaemon.kill('SIGINT');
      ipfsDaemon = null;
      setTimeout(resolve, 1000);
    } else {
      resolve();
    }
  });
}

function validateUser(token) {
  const auth = access_tokens[token];
  if (!auth || auth.expires < Date.now()) {
    return null;
  }
  return auth.userId;
}

// ========== Authentication Middleware ==========
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const userId = validateUser(token);
  
  if (!userId) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  
  req.userId = userId;
  next();
}

// ========== Core Command Handlers ==========
app.post('/auth/register', (req, res) => {
  const userId = generateUserId();
  const token = generateToken();
  
  access_tokens[token] = {
    userId,
    permissions: ['read', 'write', 'upload'],
    expires: Date.now() + (30 * 24 * 60 * 60 * 1000) // 30 days
  };
  
  user_directories[userId] = { dns: [], files: {} };
  saveData();
  
  res.json({ userId, token, message: 'User registered successfully' });
});

app.post('/command', requireAuth, async (req, res) => {
  const { cmd, args = {} } = req.body;
  const userId = req.userId;

  try {
    switch (cmd) {
      case 'start-ipfs': {
        await stopIPFS();
        await startIPFS();
        return res.json({ status: 'IPFS restarted successfully' });
      }

      case 'upload-webapp': {
        const { files, dns, metadata = {} } = args;
        
        if (dns_map[dns] && dns_map[dns].owner !== userId) {
          return res.status(403).json({ error: 'DNS name already taken by another user' });
        }

        // Create temporary directory
        const tempDir = path.join(__dirname, 'temp', `webapp-${Date.now()}`);
        fs.mkdirSync(tempDir, { recursive: true });

        // Write all files
        for (const [filename, content] of Object.entries(files)) {
          const filePath = path.join(tempDir, filename);
          const fileDir = path.dirname(filePath);
          fs.mkdirSync(fileDir, { recursive: true });
          
          if (typeof content === 'string') {
            fs.writeFileSync(filePath, content);
          } else {
            fs.writeFileSync(filePath, Buffer.from(content, 'base64'));
          }
          
          file_ownership[filename] = userId;
        }

        // Add metadata
        const metaPath = path.join(tempDir, 'meta.json');
        fs.writeFileSync(metaPath, JSON.stringify({
          ...metadata,
          owner: userId,
          created: new Date().toISOString(),
          type: 'webapp'
        }, null, 2));

        // Upload to IPFS
        const result = await execPromise(`ipfs add -r .`, tempDir);
        const lines = result.trim().split('\n');
        const cid = lines[lines.length - 1].split(' ')[1];

        // Update mappings
        const oldCID = dns_map[dns]?.cid;
        dns_map[dns] = {
          cid,
          owner: userId,
          created: dns_map[dns]?.created || new Date().toISOString(),
          updated: new Date().toISOString(),
          type: 'webapp'
        };

        if (!cid_history[dns]) cid_history[dns] = [];
        cid_history[dns].push({
          cid,
          timestamp: new Date().toISOString(),
          version: cid_history[dns].length + 1
        });

        if (!user_directories[userId].dns.includes(dns)) {
          user_directories[userId].dns.push(dns);
        }

        // Cleanup
        fs.rmSync(tempDir, { recursive: true, force: true });
        saveData();

        return res.json({ dns, cid, oldCID, version: cid_history[dns].length });
      }

      case 'upload-file': {
        const { filename, content, dns, encoding = 'utf8' } = args;
      
        if (!dns_map[dns]) {
          return res.status(404).json({ error: 'DNS not found' });
        }
        
        console.log(`🌐 Public file update: ${filename} on ${dns}`);
      
        // Get current webapp content
        const currentCID = dns_map[dns].cid;
        const tempDir = path.join(__dirname, 'temp', `update-${Date.now()}`);
        
        // Download current content
        await execPromise(`ipfs get ${currentCID} -o ${tempDir}`);
        const webappDir = path.join(tempDir, currentCID);
        
        // Update or add the file
        const filePath = path.join(webappDir, filename);
        const fileDir = path.dirname(filePath);
        fs.mkdirSync(fileDir, { recursive: true });
        
        if (encoding === 'base64') {
          fs.writeFileSync(filePath, Buffer.from(content, 'base64'));
        } else {
          fs.writeFileSync(filePath, content);
        }
      
        // Re-upload to IPFS
        const result = await execPromise(`ipfs add -r .`, webappDir);
        const lines = result.trim().split('\n');
        const newCID = lines[lines.length - 1].split(' ')[1];
      
        // Update DNS mapping to new CID
        dns_map[dns].cid = newCID;
        dns_map[dns].updated = new Date().toISOString();
        
        // Track version history
        cid_history[dns].push({
          cid: newCID,
          timestamp: new Date().toISOString(),
          version: cid_history[dns].length + 1,
          action: `Updated file: ${filename}`
        });
      
        // Cleanup
        fs.rmSync(tempDir, { recursive: true, force: true });
        saveData();
      
        return res.json({ 
          dns, 
          filename, 
          newCID, 
          oldCID: currentCID,
          version: cid_history[dns].length 
        });
      }

      case 'delete-file': {
        const { filename, dns } = args;
        
        if (!dns_map[dns] || dns_map[dns].owner !== userId) {
          return res.status(403).json({ error: 'You do not own this DNS or it does not exist' });
        }

        if (file_ownership[filename] !== userId) {
          return res.status(403).json({ error: 'You do not own this file' });
        }

        // Similar process as upload-file but remove the file instead
        const currentCID = dns_map[dns].cid;
        const tempDir = path.join(__dirname, 'temp', `delete-${Date.now()}`);
        
        await execPromise(`ipfs get ${currentCID} -o ${tempDir}`);
        const webappDir = path.join(tempDir, currentCID);
        const filePath = path.join(webappDir, filename);
        
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }

        const result = await execPromise(`ipfs add -r .`, webappDir);
        const lines = result.trim().split('\n');
        const newCID = lines[lines.length - 1].split(' ')[1];

        dns_map[dns].cid = newCID;
        dns_map[dns].updated = new Date().toISOString();
        
        cid_history[dns].push({
          cid: newCID,
          timestamp: new Date().toISOString(),
          version: cid_history[dns].length + 1,
          action: `Deleted file: ${filename}`
        });

        delete user_directories[userId].files[filename];
        delete file_ownership[filename];

        fs.rmSync(tempDir, { recursive: true, force: true });
        saveData();

        return res.json({ dns, filename, newCID, deleted: true });
      }

      case 'list-user-sites': {
        const userSites = user_directories[userId]?.dns || [];
        const sites = userSites.map(dns => ({
          dns,
          ...dns_map[dns],
          versions: cid_history[dns]?.length || 0
        }));
        
        return res.json({ sites, total: sites.length });
      }

      case 'get-site-history': {
        const { dns } = args;
        
        if (!dns_map[dns] || dns_map[dns].owner !== userId) {
          return res.status(403).json({ error: 'Access denied' });
        }

        return res.json({
          dns,
          current: dns_map[dns],
          history: cid_history[dns] || []
        });
      }

      case 'rollback-version': {
        const { dns, version } = args;
        
        if (!dns_map[dns] || dns_map[dns].owner !== userId) {
          return res.status(403).json({ error: 'Access denied' });
        }

        const history = cid_history[dns];
        if (!history || version < 1 || version > history.length) {
          return res.status(400).json({ error: 'Invalid version' });
        }

        const targetVersion = history[version - 1];
        dns_map[dns].cid = targetVersion.cid;
        dns_map[dns].updated = new Date().toISOString();
        
        cid_history[dns].push({
          cid: targetVersion.cid,
          timestamp: new Date().toISOString(),
          version: history.length + 1,
          action: `Rolled back to version ${version}`
        });

        saveData();
        return res.json({ dns, rolledBackTo: version, newCID: targetVersion.cid });
      }

      default:
        return res.status(400).json({ error: 'Unknown command' });
    }
  } catch (err) {
    console.error('❌ Command error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ========== File Upload Endpoint ==========
// app.post('/upload-files', requireAuth, upload.array('files'), async (req, res) => {
//   const { dns } = req.body;
//   const userId = req.userId;
  
//   try {
//     if (!dns_map[dns] || dns_map[dns].owner !== userId) {
//       return res.status(403).json({ error: 'Access denied' });
//     }

//     const uploadedFiles = [];
//     for (const file of req.files) {
//       const content = fs.readFileSync(file.path);
      
//       // Add individual file to IPFS
//       const tempFile = path.join(__dirname, 'temp', file.originalname);
//       fs.mkdirSync(path.dirname(tempFile), { recursive: true });
//       fs.writeFileSync(tempFile, content);
      
//       const result = await execPromise(`ipfs add ${tempFile}`);
//       const fileCID = result.trim().split(' ')[1];
      
//       uploadedFiles.push({
//         filename: file.originalname,
//         cid: fileCID,
//         size: file.size
//       });
      
//       user_directories[userId].files[file.originalname] = fileCID;
//       file_ownership[file.originalname] = userId;
      
//       // Cleanup
//       fs.unlinkSync(file.path);
//       fs.unlinkSync(tempFile);
//     }

//     saveData();
//     res.json({ uploadedFiles, count: uploadedFiles.length });
//   } catch (err) {
//     console.error('Upload error:', err);
//     res.status(500).json({ error: err.message });
//   }
// });

app.post('/upload-files', requireAuth, upload.array('files'), async (req, res) => {
    const { dns } = req.body;
    const userId = req.userId;
    
    try {
      // Check if DNS exists (but don't check ownership - it's public!)
      if (!dns_map[dns]) {
        return res.status(404).json({ error: 'DNS not found' });
      }
  
      console.log(`🌐 Public update: User ${userId} updating ${dns}`);
  
      // Get current website content
      const currentCID = dns_map[dns].cid;
      const tempDir = path.join(__dirname, 'temp', `update-files-${Date.now()}`);
      
      // Download current website
      await execPromise(`ipfs get ${currentCID} -o ${tempDir}`);
      const webappDir = path.join(tempDir, currentCID);
      
      const uploadedFiles = [];
      
      // Process each uploaded file
      for (const file of req.files) {
        const content = fs.readFileSync(file.path);
        
        // Update file in website structure
        const filePath = path.join(webappDir, file.originalname);
        const fileDir = path.dirname(filePath);
        fs.mkdirSync(fileDir, { recursive: true });
        fs.writeFileSync(filePath, content);
        
        uploadedFiles.push({
          filename: file.originalname,
          size: file.size,
          updated: true
        });
        
        // Cleanup uploaded file
        fs.unlinkSync(file.path);
      }
  
      // Re-upload entire website to IPFS
      const result = await execPromise(`ipfs add -r .`, webappDir);
      const lines = result.trim().split('\n');
      const newCID = lines[lines.length - 1].split(' ')[1];
  
      // Update DNS mapping (keep original owner)
      dns_map[dns].cid = newCID;
      dns_map[dns].updated = new Date().toISOString();
      
      // Add to history
      cid_history[dns].push({
        cid: newCID,
        timestamp: new Date().toISOString(),
        version: cid_history[dns].length + 1,
        action: `Public update: ${uploadedFiles.length} files by user ${userId}`
      });
  
      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
      saveData();
  
      res.json({ 
        uploadedFiles, 
        count: uploadedFiles.length,
        newCID,
        oldCID: currentCID,
        dns,
        version: cid_history[dns].length,
        message: 'Public website updated successfully'
      });
      
    } catch (err) {
      console.error('Upload error:', err);
      res.status(500).json({ error: err.message });
    }
  });

// ========== ZIP Upload Endpoint ==========
app.post('/upload-zip', requireAuth, upload.single('zipfile'), async (req, res) => {
    const { dns, metadata } = req.body;
    const userId = req.userId;
    
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No ZIP file uploaded' });
      }
  
      if (dns_map[dns] && dns_map[dns].owner !== userId) {
        return res.status(403).json({ error: 'DNS name already taken by another user' });
      }
  
      console.log("📦 Processing ZIP upload for DNS:", dns);
      console.log("📁 Original file:", req.file.originalname, "Size:", req.file.size);
  
      // Read the uploaded ZIP file
      const zipData = fs.readFileSync(req.file.path);
      
      // Create temporary directory
      const tempDir = path.join(__dirname, 'temp', `webapp-zip-${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });
  
      try {
        // Write ZIP data to temp file
        const zipPath = path.join(tempDir, 'upload.zip');
        fs.writeFileSync(zipPath, zipData);
        console.log("💾 ZIP written to:", zipPath);
  
        // Extract ZIP
        const zip = new AdmZip(zipPath);
        const extractPath = path.join(tempDir, 'extracted');
        zip.extractAllTo(extractPath, true);
        console.log("📂 ZIP extracted to:", extractPath);
  
        // Check what was extracted
        const extractedContents = fs.readdirSync(extractPath);
        let contentDir = extractPath;

        const validDirs = extractedContents.filter(item => 
            !item.startsWith('.') && 
            !item.startsWith('__MACOSX') &&
            fs.statSync(path.join(extractPath, item)).isDirectory()
          );
          
          const validFiles = extractedContents.filter(item => 
            !item.startsWith('.') && 
            !item.startsWith('__MACOSX') &&
            fs.statSync(path.join(extractPath, item)).isFile()
          );
          
          console.log("📁 Valid directories found:", validDirs);
          console.log("📄 Valid files found:", validFiles);
          
        console.log("📁 Valid directories found:", validDirs);
        console.log("📄 Valid files found:", validFiles);

        if (validFiles.length === 0 && validDirs.length === 1) {
            contentDir = path.join(extractPath, validDirs[0]);
            console.log("🎯 Using nested directory as content root:", contentDir);
          } else {
            console.log("🎯 Using extract path as content root:", contentDir);
        }
        
  
        // List all items in content directory
        const contentItems = fs.readdirSync(contentDir);
        console.log("📄 Items in content directory:", contentItems);
  
        // Track all files for ownership
        const allFiles = [];
        function collectFiles(dir, relativePath = '') {
          console.log(`🔍 Scanning directory: ${dir} (relative: ${relativePath})`);
          const items = fs.readdirSync(dir);
          
          for (const item of items) {
            if (item.startsWith('.') || item.startsWith('__MACOSX')) {
              console.log(`⏭️ Skipping system file/folder: ${item}`);
              continue;
            }
            
            const fullPath = path.join(dir, item);
            const relPath = path.join(relativePath, item).replace(/\\/g, '/');
            const stats = fs.statSync(fullPath);
            
            if (stats.isDirectory()) {
              console.log(`📁 Found directory: ${item} -> ${relPath}`);
              collectFiles(fullPath, relPath);
            } else {
              console.log(`📄 Found file: ${item} -> ${relPath} (${stats.size} bytes)`);
              allFiles.push(relPath);
              file_ownership[relPath] = userId;
            }
          }
        }
        
        collectFiles(contentDir);
        console.log("✅ Total files collected:", allFiles.length);
        console.log("📋 File list:", allFiles);
  
        // Add metadata file
        const metaPath = path.join(contentDir, 'meta.json');
        fs.writeFileSync(metaPath, JSON.stringify({
          ...(metadata ? JSON.parse(metadata) : {}),
          owner: userId,
          created: new Date().toISOString(),
          type: 'webapp-zip',
          fileCount: allFiles.length,
          structure: allFiles
        }, null, 2));
  
        console.log("🚀 Uploading to IPFS from:", contentDir);
        
        // Upload to IPFS
        const result = await execPromise(`ipfs add -r .`, contentDir);
        console.log("📡 IPFS add result:", result);
        
        const lines = result.trim().split('\n');
        const cid = lines[lines.length - 1].split(' ')[1];
        console.log("🎉 Final CID:", cid);
  
        // Update mappings
        const oldCID = dns_map[dns]?.cid;
        dns_map[dns] = {
          cid,
          owner: userId,
          created: dns_map[dns]?.created || new Date().toISOString(),
          updated: new Date().toISOString(),
          type: 'webapp-zip',
          fileCount: allFiles.length
        };
  
        if (!cid_history[dns]) cid_history[dns] = [];
        cid_history[dns].push({
          cid,
          timestamp: new Date().toISOString(),
          version: cid_history[dns].length + 1,
          action: 'ZIP upload',
          fileCount: allFiles.length
        });
  
        if (!user_directories[userId].dns.includes(dns)) {
          user_directories[userId].dns.push(dns);
        }
  
        // Cleanup
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.unlinkSync(req.file.path);
        saveData();
  
        return res.json({ 
          dns, 
          cid, 
          oldCID, 
          version: cid_history[dns].length,
          fileCount: allFiles.length,
          structure: allFiles
        });
  
      } catch (err) {
        console.error("❌ ZIP processing error:", err);
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
        throw err;
      }
      
    } catch (err) {
      console.error('❌ ZIP upload error:', err);
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ error: err.message });
    }
  });

// ========== Content Resolution ==========
app.post('/resolve-ipfs', async (req, res) => {
  let { cid, filePath = '' } = req.body;
  
  const fileURL = `http://localhost:8080/ipfs/${cid}/${filePath}`;
  console.log("🔗 Proxying:", fileURL);
  
  try {
    const response = await fetch(fileURL);
    const contentType = response.headers.get('content-type') || 'text/plain';
    res.setHeader('Content-Type', contentType);
    
    if (contentType.startsWith('text/') || contentType.includes('json')) {
      const data = await response.text();
      res.send(data);
    } else {
      const buffer = await response.buffer();
      res.send(buffer);
    }
  } catch (err) {
    console.error("❌ Fetch error:", err.message);
    res.status(500).send('Fetch error: ' + err.message);
  }
});

// app.get('/resolve-dns/:dns', async (req, res) => {
//   const dns = req.params.dns;
//   const site = dns_map[dns];
  
//   if (!site) {
//     return res.status(404).json({ error: 'DNS not found' });
//   }
  
//   try {
//     const tree = await getIPFSTree(site.cid);
//     return res.json({ 
//       dns,
//       ...site,
//       tree,
//       versions: cid_history[dns]?.length || 0
//     });
//   } catch (err) {
//     console.error('❌ DNS resolution error:', err);
//     return res.status(500).json({ error: 'Failed to fetch IPFS tree' });
//   }
// });

// ========== Platform Stats ==========

app.get('/stats', (req, res) => {
  res.json({
    totalSites: Object.keys(dns_map).length,
    totalUsers: Object.keys(user_directories).length,
    totalFiles: Object.keys(file_ownership).length,
    activeTokens: Object.keys(access_tokens).filter(token => 
      access_tokens[token].expires > Date.now()
    ).length
  });
});

app.get('/site/:dns', async (req, res) => {
  const dns = req.params.dns;
  const site = dns_map[dns];
  
  if (!site) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Site Not Found</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 100px; background: #f5f5f5; }
          .error { background: white; padding: 60px; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); display: inline-block; }
          h1 { color: #e74c3c; margin-bottom: 20px; }
          p { color: #666; margin-bottom: 30px; }
          a { color: #3498db; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="error">
          <h1>🌐 Site Not Found</h1>
          <p>The site <strong>${dns}</strong> does not exist on this IPFS platform.</p>
          <a href="http://localhost:3000/">← Back to Platform</a>
        </div>
      </body>
      </html>
    `);
  }
  
  // Redirect to current IPFS content
  res.redirect(`http://localhost:8080/ipfs/${site.cid}`);
});

// Enhanced resolve-dns with better formatting
app.get('/resolve-dns/:dns', async (req, res) => {
  const dns = req.params.dns;
  const site = dns_map[dns];
  
  if (!site) {
    return res.status(404).json({ error: 'DNS not found' });
  }
  
  try {
    const tree = await getIPFSTree(site.cid);
    
    // If it's a web request (browser), return HTML
    if (req.headers.accept && req.headers.accept.includes('text/html')) {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>DNS Info: ${dns}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; background: #f5f5f5; }
            .container { max-width: 800px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
            .header { border-bottom: 2px solid #3498db; padding-bottom: 20px; margin-bottom: 30px; }
            .header h1 { color: #2c3e50; margin: 0; }
            .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
            .info-card { background: #f8f9fa; padding: 20px; border-radius: 8px; }
            .info-card h3 { margin: 0 0 10px 0; color: #2c3e50; }
            .info-card p { margin: 5px 0; color: #666; }
            .cid { font-family: monospace; background: #e9ecef; padding: 10px; border-radius: 5px; word-break: break-all; }
            .actions { margin-top: 30px; }
            .btn { background: #3498db; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin-right: 10px; display: inline-block; }
            .btn:hover { background: #2980b9; }
            .tree { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-top: 20px; }
            .tree pre { margin: 0; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🌐 ${dns}</h1>
              <p>IPFS Site Information</p>
            </div>
            
            <div class="info-grid">
              <div class="info-card">
                <h3>📦 Current CID</h3>
                <div class="cid">${site.cid}</div>
              </div>
              <div class="info-card">
                <h3>📊 Site Details</h3>
                <p><strong>Type:</strong> ${site.type}</p>
                <p><strong>Versions:</strong> ${cid_history[dns]?.length || 1}</p>
                <p><strong>Created:</strong> ${new Date(site.created).toLocaleDateString()}</p>
                <p><strong>Updated:</strong> ${new Date(site.updated).toLocaleDateString()}</p>
              </div>
            </div>
            
            <div class="actions">
              <a href="http://localhost:8080/ipfs/${site.cid}" class="btn">🔗 View Site</a>
              <a href="http://localhost:3000/resolve-dns/${dns}?format=json" class="btn">📋 JSON Data</a>
              <a href="http://localhost:3000/" class="btn">🏠 Platform Home</a>
            </div>
            
            <div class="tree">
              <h3>📁 File Structure</h3>
              <pre>${JSON.stringify(tree, null, 2)}</pre>
            </div>
          </div>
        </body>
        </html>
      `);
    }
    
    // Otherwise return JSON
    return res.json({ 
      dns,
      ...site,
      tree,
      versions: cid_history[dns]?.length || 0,
      gateway_url: `http://localhost:8080/ipfs/${site.cid}`,
      platform_url: `http://localhost:3000/site/${dns}`
    });
  } catch (err) {
    console.error('❌ DNS resolution error:', err);
    return res.status(500).json({ error: 'Failed to fetch IPFS tree' });
  }
});

// ========== Server Startup ==========
loadData();

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🌐 IPFS Web Platform running on http://localhost:${PORT}`);
  console.log(`📊 Loaded ${Object.keys(dns_map).length} sites, ${Object.keys(user_directories).length} users`);
  
  try {
    await startIPFS();
    console.log('✅ IPFS daemon started successfully');
  } catch (err) {
    console.error('❌ Failed to start IPFS daemon:', err.message);
  }
});