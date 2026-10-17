const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const rootDirectory = __dirname;
const port = Number(process.env.PORT || 8000);

function loadLocalEnvironment() {
    const filePath = path.join(rootDirectory, ".env.local");
    if (!fs.existsSync(filePath)) return;

    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
        if (!match || process.env[match[1]]) continue;
        process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
    }
}

loadLocalEnvironment();

const firebaseDatabaseUrl = process.env.FIREBASE_DATABASE_URL ||
    "https://skin-cancer-c5f52-default-rtdb.firebaseio.com";
const firebaseGroqApiKeyPath = process.env.FIREBASE_GROQ_API_KEY_PATH || "config/groqApiKey";

async function getFirebaseApiKey() {
    const endpoint = `${firebaseDatabaseUrl.replace(/\/+$/, "")}/${firebaseGroqApiKeyPath
        .split("/")
        .map(encodeURIComponent)
        .join("/")}.json`;
    const response = await fetch(endpoint);
    if (!response.ok) {
        throw new Error(`Firebase returned HTTP ${response.status} while reading the Groq API key.`);
    }

    const value = await response.json();
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function resolveApiKey(requestApiKey) {
    if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY;

    try {
        const firebaseApiKey = await getFirebaseApiKey();
        if (firebaseApiKey) return firebaseApiKey;
    } catch (error) {
        console.warn(`Unable to load the Groq API key from Firebase: ${error.message}`);
    }

    return typeof requestApiKey === "string" && requestApiKey.trim()
        ? requestApiKey.trim()
        : undefined;
}

async function hasConfiguredApiKey() {
    if (process.env.GROQ_API_KEY) return true;

    try {
        return Boolean(await getFirebaseApiKey());
    } catch (error) {
        console.warn(`Unable to check the Firebase Groq API key: ${error.message}`);
        return false;
    }
}

function sendJson(response, statusCode, body) {
    response.writeHead(statusCode, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
}

function readRequestBody(request) {
    return new Promise((resolve, reject) => {
        let body = "";
        request.on("data", chunk => {
            body += chunk;
            if (body.length > 20 * 1024 * 1024) reject(new Error("Request is too large."));
        });
        request.on("end", () => resolve(body));
        request.on("error", reject);
    });
}

async function analyze(request, response) {
    try {
        const payload = JSON.parse(await readRequestBody(request));
        const apiKey = await resolveApiKey(payload.apiKey);
        if (!apiKey || typeof apiKey !== "string") {
            return sendJson(response, 400, { error: { message: "Add a Groq API key to .env.local, configure one in Firebase, or enter your own key in the form." } });
        }

        const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "qwen/qwen3.8-27b",
                reasoning_effort: "none",
                messages: payload.messages,
                temperature: 0.3,
                max_tokens: 1000,
                response_format: { type: "json_object" }
            })
        });

        const responseText = await upstream.text();
        let result;
        try {
            result = JSON.parse(responseText);
        } catch {
            return sendJson(response, 502, {
                error: {
                    message: `Groq returned a non-JSON response (HTTP ${upstream.status}). Check the API endpoint and key, then try again.`
                }
            });
        }
        sendJson(response, upstream.status, result);
    } catch (error) {
        sendJson(response, 400, { error: { message: error.message } });
    }
}

function serveStatic(request, response, requestUrl) {
    const requestedPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
    const filePath = path.resolve(rootDirectory, `.${requestedPath}`);
    if (!filePath.startsWith(rootDirectory + path.sep)) return sendJson(response, 403, { error: "Forbidden" });

    fs.readFile(filePath, (error, content) => {
        if (error) return sendJson(response, 404, { error: "Not found" });
        const extension = path.extname(filePath);
        const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
        response.writeHead(200, { "Content-Type": contentTypes[extension] || "application/octet-stream" });
        response.end(content);
    });
}

const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "GET" && requestUrl.pathname === "/api/config") {
        return sendJson(response, 200, { hasServerKey: await hasConfiguredApiKey() });
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/analyze") return analyze(request, response);
    if (request.method === "GET") return serveStatic(request, response, requestUrl);
    sendJson(response, 405, { error: "Method not allowed" });
});

server.listen(port, () => {
    console.log(`Local demo running at http://localhost:${port}`);
});
