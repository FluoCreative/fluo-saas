const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { ApifyClient } = require('apify-client');
const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const session = require('express-session');
const { verifyUser, getUserCredits, consumeCredit } = require('./database');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Sessão
app.use(session({
    secret: process.env.SESSION_SECRET || 'fluo-secret-key-12345',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 horas
}));

// Servir arquivos estáticos (páginas HTML)
app.use(express.static(path.join(__dirname, '../public')));

// Clientes de API
const apifyClient = new ApifyClient({ token: process.env.APIFY_API_TOKEN });
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Helpers
async function getBase64Image(url) {
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
        const base64 = Buffer.from(response.data, 'binary').toString('base64');
        const mimeType = response.headers['content-type'] || 'image/jpeg';
        return `data:${mimeType};base64,${base64}`;
    } catch (e) {
        console.error('Erro ao baixar imagem:', e.message);
        return null;
    }
}

// Middleware de autenticação
const requireAuth = (req, res, next) => {
    if (req.session && req.session.userId) {
        next();
    } else {
        res.status(401).json({ error: 'Não autorizado. Faça login primeiro.' });
    }
};

// --- ROTAS ---

// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await verifyUser(username, password);
        if (user) {
            req.session.userId = user.id;
            req.session.username = user.username;
            res.json({ success: true });
        } else {
            res.status(401).json({ error: 'Usuário ou senha inválidos' });
        }
    } catch (e) {
        console.error("Erro no login:", e);
        res.status(500).json({ error: 'Erro no servidor: ' + e.message });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Checar sessão ativa
app.get('/api/me', (req, res) => {
    if (req.session && req.session.userId) {
        res.json({ loggedIn: true, username: req.session.username });
    } else {
        res.json({ loggedIn: false });
    }
});

// Criar novo cliente (Apenas para a Fluo usar)
app.post('/api/admin/create-user', async (req, res) => {
    const { adminPassword, username, password } = req.body;
    
    // Senha master para proteger a criação de usuários
    if (adminPassword !== 'fluo-admin-2026') {
        return res.status(403).json({ error: 'Senha de administrador incorreta.' });
    }

    if (!username || !password) {
        return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
    }

    try {
        const { createUser } = require('./database');
        await createUser(username, password);
        res.json({ success: true, message: `Cliente ${username} criado com sucesso!` });
    } catch (e) {
        console.error("Erro ao criar usuário:", e);
        res.status(500).json({ error: 'Erro ao criar cliente: ' + e.message });
    }
});


// Análise Protegida
app.post('/api/analyze', requireAuth, async (req, res) => {
    try {
        const { username, businessDescription } = req.body;
        const userId = req.session.userId;
        
        // Verificar Créditos
        const credits = await getUserCredits(userId);
        if (credits <= 0) {
            return res.status(403).json({ error: 'Você atingiu o limite de 2 análises. Adquira um novo acesso para continuar.' });
        }

        if (!username) {
            return res.status(400).json({ error: 'Username do Instagram é obrigatório.' });
        }
        
        const cleanUsername = username.replace('@', '').trim();
        console.log(`[User ${req.session.username} - Creditos: ${credits}] Iniciando análise para @${cleanUsername}...`);

        let instagramData = '';
        let latestImagesHtml = '';
        try {
            // Otimização: Limitar os resultados para forçar a Apify a ser mais rápida e evitar Timeout 502
            const run = await apifyClient.actor("apify/instagram-profile-scraper").call({
                usernames: [cleanUsername],
                resultsLimit: 1
            });
            const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
            
            if (items && items.length > 0) {
                const profile = items[0];
                if (profile.error) throw new Error(`Perfil privado ou inexistente.`);
                
                const latestPosts = profile.latestPosts || [];
                const imageUrls = latestPosts.slice(0, 5).map(p => p.displayUrl || p.imageUrl || p.thumbnailUrl).filter(Boolean);
                const base64Images = await Promise.all(imageUrls.map(url => getBase64Image(url)));
                
                latestImagesHtml = base64Images.map(b64 => b64 ? `<img src="${b64}" alt="Post de @${cleanUsername}">` : '').join('');
                
                instagramData = `
                DADOS REAIS EXTRAÍDOS DO INSTAGRAM:
                - Biografia: ${profile.biography || 'Vazia'}
                - Seguidores: ${profile.followersCount || 0}
                - Seguindo: ${profile.followsCount || 0}
                - Total de Publicações: ${profile.postsCount || 0}
                - Legendas:
                ${latestPosts.slice(0, 5).map(p => `"${p.caption}"`).join('\n\n')}
                `;
            } else {
                instagramData = `Falha na extração. Cliente informou: "${businessDescription || ''}"`;
            }
        } catch (apifyErr) {
            instagramData = `Erro na extração. Cliente informou: "${businessDescription || ''}"`;
        }

        const prompt = `
Você é um estrategista de marca e diretor de criação Sênior de uma agência de marketing de altíssimo padrão chamada "Fluo Assessoria de Marketing".
Seu objetivo é fazer uma auditoria e um diagnóstico profundo, denso e extremamente detalhado para o perfil do Instagram: @${username}.
Informação adicional sobre o negócio do cliente: ${businessDescription}

Aqui estão os dados reais do perfil:
${instagramData}

Você deve gerar um diagnóstico estruturado em JSON com as chaves: instagramAnalysis, strengths(array 5 itens), weaknesses(array 5), solutions(array 5), brandPositioning(object com archetype, greatestStrength, personality, toneOfVoice, market, opportunities, challenges), immediateImprovements(array 3).
Retorne SOMENTE o JSON válido, sem markdown.
`;
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { responseMimeType: 'application/json' }
        });

        // Limpar possíveis marcações Markdown (```json ... ```) antes de fazer o parse
        let rawJson = response.text.trim();
        if (rawJson.startsWith('```')) {
            rawJson = rawJson.replace(/^```(json)?\n?/i, '').replace(/\n?```$/i, '');
        }

        const diagnostic = JSON.parse(rawJson);

        const templatePath = path.join(__dirname, '../templates', 'reportTemplate.html');
        let htmlReport = fs.readFileSync(templatePath, 'utf8');
        
        htmlReport = htmlReport.replace(/{{username}}/g, username);
        htmlReport = htmlReport.replace(/{{instagramAnalysis}}/g, diagnostic.instagramAnalysis);
        htmlReport = htmlReport.replace(/{{strengths}}/g, diagnostic.strengths.map(s => `<li>${s}</li>`).join(''));
        htmlReport = htmlReport.replace(/{{weaknesses}}/g, diagnostic.weaknesses.map((w, i) => `<li class="weakness-item"><strong>${w}</strong><em>Solução: ${diagnostic.solutions[i]}</em></li>`).join(''));
        htmlReport = htmlReport.replace(/{{archetype}}/g, diagnostic.brandPositioning.archetype);
        htmlReport = htmlReport.replace(/{{greatestStrength}}/g, diagnostic.brandPositioning.greatestStrength);
        htmlReport = htmlReport.replace(/{{personality}}/g, diagnostic.brandPositioning.personality);
        htmlReport = htmlReport.replace(/{{toneOfVoice}}/g, diagnostic.brandPositioning.toneOfVoice);
        htmlReport = htmlReport.replace(/{{market}}/g, diagnostic.brandPositioning.market);
        htmlReport = htmlReport.replace(/{{opportunities}}/g, diagnostic.brandPositioning.opportunities);
        htmlReport = htmlReport.replace(/{{challenges}}/g, diagnostic.brandPositioning.challenges);
        htmlReport = htmlReport.replace(/{{immediateImprovements}}/g, diagnostic.immediateImprovements.map(s => `<li>${s}</li>`).join(''));
        htmlReport = htmlReport.replace(/{{latestPostsImages}}/g, latestImagesHtml);

        // Consumir 1 crédito após análise gerada com sucesso
        await consumeCredit(userId);

        res.json({ success: true, html: htmlReport });
    } catch (error) {
        console.error('Erro na análise:', error);
        res.status(500).json({ error: 'Erro ao gerar o diagnóstico. Detalhe técnico: ' + error.message });
    }
});

const PORT = process.env.PORT || 8081;
app.listen(PORT, () => {
    console.log(`SaaS Backend rodando na porta ${PORT}`);
});
