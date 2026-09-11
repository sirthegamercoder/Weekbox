import { nativeFetch } from "../../services/network/native-http.js";

const ITCH_REQUEST_TIMEOUT_MS = 15_000;

function getItchUrl(pageUrl, path) {
  const page = new URL(pageUrl.endsWith("/") ? pageUrl : `${pageUrl}/`);
  if (page.protocol !== "https:" || !page.hostname.endsWith(".itch.io")) {
    throw new Error("Unsupported Itch.io URL");
  }
  return new URL(`./${path}`, page).toString();
}

function parseSize(value) {
  const match = String(value || "").match(/([\d.]+)\s*(KB|MB|GB)/i);
  if (!match) return 0;
  const units = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
  return Math.round(Number(match[1]) * units[match[2].toUpperCase()]);
}

// ponytail: parse Itch's public HTML until it exposes stable upload metadata.
function parseUploads(html, source) {
  const uploads = [];
  const uploadPattern =
    /data-upload_id=["'](\d+)["'][\s\S]*?title=["']([^"']+)["'][\s\S]*?file_size[\s\S]*?>([^<]+)<[\s\S]*?Version\s+([\d][\w.-]*)/gi;
  for (const match of html.matchAll(uploadPattern)) {
    uploads.push({
      id: match[1],
      name: match[2],
      size: parseSize(match[3]),
      version: match[4],
    });
  }

  const platformUploads = {};
  for (const [platform, pattern] of Object.entries(source.platforms)) {
    const upload = uploads.find((item) => pattern.test(item.name));
    if (upload) platformUploads[platform] = upload;
  }
  return platformUploads;
}

export async function getItchRelease(source, githubRepository = "") {
  const response = await nativeFetch(source.pageUrl, {
    timeout: ITCH_REQUEST_TIMEOUT_MS,
  });
  if (!response.ok)
    throw new Error(`Itch.io request failed: ${response.status}`);
  const version = (await response.text()).match(
    /\bVersion\s+([\d][\w.-]*)/i,
  )?.[1];
  if (!version) return null;

  return {
    version,
    label: `Itch (${version})`,
    itch: {
      pageUrl: source.pageUrl,
      platforms: Object.keys(source.platforms),
    },
    githubRepository,
  };
}

export async function resolveItchDownloadUrl(itch, platform) {
  const purchaseResponse = await nativeFetch(
    getItchUrl(itch.pageUrl, "purchase"),
    { timeout: ITCH_REQUEST_TIMEOUT_MS },
  );
  if (!purchaseResponse.ok)
    throw new Error(
      `Itch.io purchase request failed: ${purchaseResponse.status}`,
    );

  const purchaseHtml = await purchaseResponse.text();
  const csrfToken = purchaseHtml.match(
    /<meta\b[^>]*\bname=["']csrf_token["'][^>]*\bvalue=["']([^"']*)["']/i,
  )?.[1];
  if (!csrfToken) throw new Error("Itch.io download token is unavailable");

  const downloadPageResponse = await nativeFetch(
    getItchUrl(itch.pageUrl, "download_url"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Referer: getItchUrl(itch.pageUrl, "purchase"),
      },
      body: `csrf_token=${encodeURIComponent(csrfToken)}&reward_id=`,
      timeout: ITCH_REQUEST_TIMEOUT_MS,
    },
  );
  if (!downloadPageResponse.ok)
    throw new Error(
      `Itch.io download page request failed: ${downloadPageResponse.status}`,
    );
  const downloadPageUrl = (await downloadPageResponse.json())?.url;
  if (!downloadPageUrl) throw new Error("Itch.io download page is unavailable");

  const downloadPage = await nativeFetch(downloadPageUrl, {
    timeout: ITCH_REQUEST_TIMEOUT_MS,
  });
  if (!downloadPage.ok)
    throw new Error(`Itch.io download page failed: ${downloadPage.status}`);
  const uploads = parseUploads(await downloadPage.text(), {
    platforms: {
      win: /windows/i,
      lin: /linux/i,
      mac: /mac/i,
    },
  });
  const uploadId = uploads[platform]?.id;
  if (!uploadId) throw new Error("Itch.io upload is unavailable");

  const response = await nativeFetch(
    getItchUrl(
      itch.pageUrl,
      `file/${encodeURIComponent(uploadId)}?source=game_download`,
    ),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Referer: getItchUrl(itch.pageUrl, "purchase"),
      },
      body: `csrf_token=${encodeURIComponent(csrfToken)}`,
      timeout: ITCH_REQUEST_TIMEOUT_MS,
    },
  );
  if (!response.ok)
    throw new Error(`Itch.io download request failed: ${response.status}`);

  const result = await response.json();
  if (!result?.url) throw new Error("Itch.io did not return a download URL");
  return result.url;
}
