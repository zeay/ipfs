// ipfs-platform-client.js
class IPFSPlatformClient {
    constructor(baseURL = 'http://localhost:3000', token = null) {
      this.baseURL = baseURL;
      this.token = token;
    }
  
    // Authentication
    async register() {
      const response = await fetch(`${this.baseURL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) throw new Error(await response.text());
      
      const data = await response.json();
      this.token = data.token;
      return data;
    }
  
    setToken(token) {
      this.token = token;
    }
  
    // Helper for authenticated requests
    async _request(endpoint, data, method = 'POST') {
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`
      };
  
      const response = await fetch(`${this.baseURL}${endpoint}`, {
        method,
        headers,
        body: JSON.stringify(data)
      });
  
      if (!response.ok) {
        const error = await response.text();
        throw new Error(error);
      }
  
      return response.json();
    }
  
    // Core platform commands
    async startIPFS() {
      return this._request('/command', { cmd: 'start-ipfs' });
    }
  
    async uploadWebApp(dns, files, metadata = {}) {
      return this._request('/command', {
        cmd: 'upload-webapp',
        args: { dns, files, metadata }
      });
    }
  
    async uploadFile(dns, filename, content, encoding = 'utf8') {
      return this._request('/command', {
        cmd: 'upload-file',
        args: { dns, filename, content, encoding }
      });
    }
  
    async deleteFile(dns, filename) {
      return this._request('/command', {
        cmd: 'delete-file',
        args: { dns, filename }
      });
    }
  
    async listSites() {
      return this._request('/command', { cmd: 'list-user-sites' });
    }
  
    async getSiteHistory(dns) {
      return this._request('/command', {
        cmd: 'get-site-history',
        args: { dns }
      });
    }
  
    async rollbackVersion(dns, version) {
      return this._request('/command', {
        cmd: 'rollback-version',
        args: { dns, version }
      });
    }
  
    // Content resolution
    async resolveIPFS(cid, filePath = '') {
      const response = await fetch(`${this.baseURL}/resolve-ipfs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cid, filePath })
      });
  
      if (!response.ok) throw new Error(await response.text());
      return response.text();
    }
  
    async resolveDNS(dns) {
      const response = await fetch(`${this.baseURL}/resolve-dns/${dns}`);
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }
  
    // File upload with FormData
    async uploadFiles(dns, files) {
      const formData = new FormData();
      formData.append('dns', dns);
      
      files.forEach(file => {
        formData.append('files', file);
      });
  
      const response = await fetch(`${this.baseURL}/upload-files`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.token}` },
        body: formData
      });
  
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }
  
    // Platform stats
    async getStats() {
      const response = await fetch(`${this.baseURL}/stats`);
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }
  
    // Convenience methods
    async createStaticSite(dns, indexHTML, styles = {}, scripts = {}, assets = {}) {
      const files = {
        'index.html': indexHTML,
        ...Object.fromEntries(
          Object.entries(styles).map(([name, content]) => [`styles/${name}`, content])
        ),
        ...Object.fromEntries(
          Object.entries(scripts).map(([name, content]) => [`scripts/${name}`, content])
        ),
        ...Object.fromEntries(
          Object.entries(assets).map(([name, content]) => [`assets/${name}`, content])
        )
      };
  
      return this.uploadWebApp(dns, files, { type: 'static-site' });
    }
  
    async updateSiteData(dns, data) {
      const dataJSON = JSON.stringify(data, null, 2);
      return this.uploadFile(dns, 'data.json', dataJSON);
    }
  
    async getSiteData(dns) {
      try {
        const site = await this.resolveDNS(dns);
        const dataContent = await this.resolveIPFS(site.cid, 'data.json');
        return JSON.parse(dataContent);
      } catch (err) {
        return null;
      }
    }
  
    // Batch operations
    async batchUploadFiles(dns, fileMap) {
      const results = [];
      for (const [filename, content] of Object.entries(fileMap)) {
        try {
          const result = await this.uploadFile(dns, filename, content);
          results.push({ filename, success: true, result });
        } catch (err) {
          results.push({ filename, success: false, error: err.message });
        }
      }
      return results;
    }
  
    // Site management helpers
    async cloneSite(sourceDNS, targetDNS) {
      const source = await this.resolveDNS(sourceDNS);
      
      // This would need server-side implementation to properly clone
      throw new Error('Clone functionality requires server-side implementation');
    }
  
    getIPFSGatewayURL(cid, path = '') {
      return `http://localhost:8080/ipfs/${cid}/${path}`;
    }
  }
  
  // Example usage
  async function example() {
    const client = new IPFSPlatformClient();
    
    // Register new user
    const auth = await client.register();
    console.log('Registered:', auth);
  
    // Create a simple website
    const indexHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>My IPFS Site</title>
        <link rel="stylesheet" href="styles/main.css">
      </head>
      <body>
        <h1>Hello IPFS!</h1>
        <p>This site is hosted on IPFS</p>
        <script src="scripts/app.js"></script>
      </body>
      </html>
    `;
  
    const styles = {
      'main.css': `
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #2196F3; }
      `
    };
  
    const scripts = {
      'app.js': `
        console.log('IPFS site loaded!');
        
        // Example: Update site data
        async function updateData() {
          const response = await fetch('/api/update-data', {
            method: 'POST',
            body: JSON.stringify({ visits: Date.now() })
          });
        }
      `
    };
  
    // Upload the website
    const result = await client.createStaticSite('my-site', indexHTML, styles, scripts);
    console.log('Site uploaded:', result);
  
    // Update site data
    await client.updateSiteData('my-site', {
      title: 'My IPFS Site',
      created: new Date().toISOString(),
      visits: 0
    });
  
    // List all sites
    const sites = await client.listSites();
    console.log('My sites:', sites);
  }
  
  // Export for use in different environments
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = IPFSPlatformClient;
  } else if (typeof window !== 'undefined') {
    window.IPFSPlatformClient = IPFSPlatformClient;
  }