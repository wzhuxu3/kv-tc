// Cloudflare Worker 完整代码
// 绑定 KV 命名空间: IMG_KV

// 生成唯一文件名
function generateFileName(originalName) {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const ext = originalName.split('.').pop() || 'jpg';
  return `${timestamp}-${random}.${ext}`;
}

// 获取 MIME 类型
function getMimeType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const mimes = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp'
  };
  return mimes[ext] || 'application/octet-stream';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS 头（支持跨域访问）
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // 处理 OPTIONS 预检请求
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ========== 1. 上传图片 API ==========
    if (path === '/api/upload' && method === 'POST') {
      try {
        const formData = await request.formData();
        const image = formData.get('image');
        
        if (!image) {
          return new Response(JSON.stringify({ error: '未提供图片文件' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        // 验证文件类型
        if (!image.type || !image.type.startsWith('image/')) {
          return new Response(JSON.stringify({ error: '只支持图片文件' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        // 限制文件大小 25MB
        if (image.size > 25 * 1024 * 1024) {
          return new Response(JSON.stringify({ error: '文件大小不能超过 25MB' }), {
            status: 413,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        // 生成唯一文件名
        const originalName = image.name;
        const fileName = generateFileName(originalName);
        const fileKey = `images/${fileName}`;

        // 读取文件内容并存储到 KV
        const arrayBuffer = await image.arrayBuffer();
        const base64Data = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
        
        // 存储元数据和图片数据
        const imageData = {
          data: base64Data,
          mime: image.type,
          name: originalName,
          size: image.size,
          uploaded: Date.now()
        };

        await env.IMG_KV.put(fileKey, JSON.stringify(imageData));
        
        // 构建访问 URL
        const imageUrl = `${url.origin}/image/${fileName}`;
        
        return new Response(JSON.stringify({
          success: true,
          url: imageUrl,
          key: fileKey,
          name: originalName
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
        
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // ========== 2. 获取图片列表 API ==========
    if (path === '/api/list' && method === 'GET') {
      try {
        const list = await env.IMG_KV.list({ prefix: 'images/' });
        const images = [];
        
        for (const key of list.keys) {
          const value = await env.IMG_KV.get(key.name);
          if (value) {
            const data = JSON.parse(value);
            const fileName = key.name.replace('images/', '');
            images.push({
              key: key.name,
              url: `${url.origin}/image/${fileName}`,
              name: data.name,
              size: data.size,
              uploaded: data.uploaded
            });
          }
        }
        
        // 按上传时间倒序排列
        images.sort((a, b) => b.uploaded - a.uploaded);
        
        return new Response(JSON.stringify({ images }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
        
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // ========== 3. 删除图片 API ==========
    if (path.startsWith('/api/delete/') && method === 'DELETE') {
      try {
        const key = path.replace('/api/delete/', '');
        const fullKey = `images/${key}`;
        
        // 检查是否存在
        const existing = await env.IMG_KV.get(fullKey);
        if (!existing) {
          return new Response(JSON.stringify({ error: '图片不存在' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        
        await env.IMG_KV.delete(fullKey);
        
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
        
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // ========== 4. 访问图片（外链） ==========
    if (path.startsWith('/image/') && method === 'GET') {
      try {
        const fileName = path.replace('/image/', '');
        const key = `images/${fileName}`;
        
        const imageDataRaw = await env.IMG_KV.get(key);
        if (!imageDataRaw) {
          return new Response('图片未找到', { status: 404 });
        }
        
        const imageData = JSON.parse(imageDataRaw);
        const binaryString = atob(imageData.data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        
        return new Response(bytes, {
          status: 200,
          headers: {
            'Content-Type': imageData.mime,
            'Cache-Control': 'public, max-age=31536000',
            'Access-Control-Allow-Origin': '*'
          }
        });
        
      } catch (error) {
        return new Response('图片加载失败', { status: 500 });
      }
    }

    // ========== 5. 前端页面 ==========
    // 返回之前提供的 HTML 页面
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CF KV 图床</title>
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
            background: #f5f7fb;
            margin: 0;
            padding: 24px 16px;
            color: #1e293b;
        }
        .container { max-width: 1100px; margin: 0 auto; }
        .card {
            background: white;
            border-radius: 28px;
            box-shadow: 0 8px 20px rgba(0,0,0,0.05);
            padding: 28px 24px;
            margin-bottom: 32px;
        }
        h1 {
            font-size: 1.9rem;
            font-weight: 600;
            margin: 0 0 8px 0;
            background: linear-gradient(135deg, #3b82f6, #8b5cf6);
            background-clip: text;
            -webkit-background-clip: text;
            color: transparent;
        }
        .upload-area {
            border: 2px dashed #cbd5e1;
            border-radius: 24px;
            padding: 32px 20px;
            text-align: center;
            cursor: pointer;
            transition: 0.2s;
        }
        .upload-area:hover {
            border-color: #3b82f6;
            background: #f8fafc;
        }
        .file-input { display: none; }
        .btn {
            background: #3b82f6;
            border: none;
            color: white;
            padding: 10px 22px;
            border-radius: 60px;
            font-weight: 500;
            cursor: pointer;
        }
        .btn-secondary { background: #334155; }
        .image-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
            gap: 20px;
            margin-top: 20px;
        }
        .image-item {
            background: white;
            border-radius: 20px;
            overflow: hidden;
            border: 1px solid #eef2ff;
        }
        .image-preview {
            width: 100%;
            aspect-ratio: 1 / 1;
            object-fit: cover;
        }
        .image-info { padding: 12px; }
        .image-link {
            font-size: 0.7rem;
            word-break: break-all;
            background: #f1f5f9;
            padding: 6px 8px;
            border-radius: 12px;
            margin: 8px 0;
        }
        .action-buttons { display: flex; gap: 8px; }
        .small-btn {
            background: none;
            border: 1px solid #cbd5e1;
            padding: 4px 10px;
            border-radius: 30px;
            font-size: 0.7rem;
            cursor: pointer;
        }
        .empty-state { text-align: center; padding: 50px 20px; color: #64748b; }
        footer { text-align: center; font-size: 0.75rem; color: #94a3b8; margin-top: 30px; }
    </style>
</head>
<body>
<div class="container">
    <div class="card">
        <h1>☁️ CF KV 图床</h1>
        <div class="upload-area" id="dropZone">
            <div style="font-size: 48px;">📸</div>
            <p>点击或拖拽图片至此区域上传</p>
            <input type="file" id="fileInput" class="file-input" accept="image/*" multiple>
        </div>
        <div id="statusMsg" style="margin-top:12px;"></div>
    </div>
    <div class="card">
        <div style="display: flex; justify-content: space-between;">
            <h2>📁 已上传的图片</h2>
            <button id="refreshBtn" class="btn btn-secondary">刷新列表</button>
        </div>
        <div id="galleryContainer"></div>
    </div>
    <footer>数据存储于 Cloudflare KV | 外链永久有效</footer>
</div>
<script>
    const API_BASE = '/api';
    function setStatus(msg, isError = false) {
        const div = document.getElementById('statusMsg');
        div.innerHTML = msg;
        div.style.color = isError ? '#dc2626' : '#10b981';
    }
    
    async function uploadImage(file) {
        const formData = new FormData();
        formData.append('image', file);
        const resp = await fetch(\`\${API_BASE}/upload\`, { method: 'POST', body: formData });
        return await resp.json();
    }
    
    async function uploadMultiple(files) {
        let success = 0;
        for (let file of files) {
            setStatus(\`上传: \${file.name}\`);
            const result = await uploadImage(file);
            if (result.success) success++;
        }
        setStatus(\`✅ 成功上传 \${success}/\${files.length} 张图片\`);
        loadGallery();
    }
    
    async function loadGallery() {
        const resp = await fetch(\`\${API_BASE}/list\`);
        const data = await resp.json();
        const container = document.getElementById('galleryContainer');
        if (!data.images || data.images.length === 0) {
            container.innerHTML = '<div class="empty-state">暂无图片</div>';
            return;
        }
        let html = '<div class="image-grid">';
        for (let img of data.images) {
            html += \`
                <div class="image-item">
                    <img class="image-preview" src="\${img.url}" alt="\${img.name}">
                    <div class="image-info">
                        <div class="image-link">\${img.url.substring(0, 50)}...</div>
                        <div class="action-buttons">
                            <button class="small-btn" onclick="copyToClipboard('\${img.url}')">复制链接</button>
                            <button class="small-btn" onclick="deleteImage('\${img.key.replace('images/', '')}')">删除</button>
                        </div>
                    </div>
                </div>
            \`;
        }
        html += '</div>';
        container.innerHTML = html;
    }
    
    window.copyToClipboard = async (text) => {
        await navigator.clipboard.writeText(text);
        alert('已复制: ' + text);
    };
    
    window.deleteImage = async (key) => {
        if (!confirm('确定删除？')) return;
        const resp = await fetch(\`\${API_BASE}/delete/\${key}\`, { method: 'DELETE' });
        if (resp.ok) {
            setStatus('删除成功');
            loadGallery();
        }
    };
    
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    dropZone.onclick = () => fileInput.click();
    dropZone.ondragover = (e) => e.preventDefault();
    dropZone.ondrop = (e) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        uploadMultiple(files);
    };
    fileInput.onchange = (e) => uploadMultiple(Array.from(e.target.files));
    document.getElementById('refreshBtn').onclick = () => loadGallery();
    loadGallery();
</script>
</body>
</html>`;
    
    return new Response(html, {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
  }
};