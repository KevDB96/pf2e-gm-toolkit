// Pure helpers for turning ordinary YouTube links into safe embed URLs.

const ID = /^[A-Za-z0-9_-]{11}$/;
const LIST = /^[A-Za-z0-9_-]{10,80}$/;

export function youtubeSource(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  let video = '';

  if (host === 'youtu.be') {
    video = url.pathname.split('/').filter(Boolean)[0] || '';
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'watch') video = url.searchParams.get('v') || '';
    if (['embed', 'shorts', 'live'].includes(parts[0])) video = parts[1] || '';
  } else {
    return null;
  }

  const list = url.searchParams.get('list') || '';
  if (video && !ID.test(video)) return null;
  if (list && !LIST.test(list)) return null;
  if (!video && !list) return null;

  const params = new URLSearchParams({ playsinline: '1' });
  if (video) params.set('autoplay', '1');
  if (list) {
    params.set('list', list);
    if (!video) params.set('listType', 'playlist');
  }

  const path = video ? video : 'videoseries';
  return `https://www.youtube-nocookie.com/embed/${path}?${params}`;
}
