function base64url(arr: Uint8Array): string {
  const bin = String.fromCharCode(...arr);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";
  const pemContents = pem
    .replace(pemHeader, "")
    .replace(pemFooter, "")
    .replace(/\s/g, "");

  const binaryDerString = atob(pemContents);
  const binaryDer = new Uint8Array(binaryDerString.length);
  for (let i = 0; i < binaryDerString.length; i++) {
    binaryDer[i] = binaryDerString.charCodeAt(i);
  }

  return await crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );
}

async function signJwt(header: object, claims: object, privateKey: CryptoKey): Promise<string> {
  const encoder = new TextEncoder();
  const headerStr = base64url(encoder.encode(JSON.stringify(header)));
  const claimsStr = base64url(encoder.encode(JSON.stringify(claims)));
  const input = `${headerStr}.${claimsStr}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    encoder.encode(input)
  );
  return `${input}.${base64url(new Uint8Array(signature))}`;
}

export async function getGoogleAccessToken(scope: string): Promise<string> {
  const saJsonStr = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!saJsonStr) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON in environment variables");
  }

  let sa;
  try {
    sa = JSON.parse(saJsonStr);
  } catch (err) {
    throw new Error(`Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON: ${err.message}`);
  }

  const { client_email, private_key } = sa;
  if (!client_email || !private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key");
  }

  const privateKey = await importPrivateKey(private_key);
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: client_email,
    scope: scope,
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const jwt = await signJwt(header, claims, privateKey);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OAuth2 token exchange failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error("OAuth2 response did not contain access_token");
  }

  return data.access_token;
}
