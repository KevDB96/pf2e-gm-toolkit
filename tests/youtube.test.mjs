import { test } from 'node:test';
import assert from 'node:assert/strict';
import { youtubeSource } from '../src/youtube.js';

test('ordinary YouTube links become privacy-enhanced embeds', () => {
  assert.equal(
    youtubeSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1&autoplay=1'
  );
  assert.equal(
    youtubeSource('youtu.be/dQw4w9WgXcQ?t=42'),
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1&autoplay=1'
  );
  assert.equal(
    youtubeSource('https://youtube.com/shorts/dQw4w9WgXcQ'),
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1&autoplay=1'
  );
});

test('playlist links retain their list id', () => {
  assert.equal(
    youtubeSource('https://www.youtube.com/playlist?list=PL1234567890'),
    'https://www.youtube-nocookie.com/embed/videoseries?playsinline=1&list=PL1234567890&listType=playlist'
  );
});

test('non-YouTube and malformed links are rejected', () => {
  assert.equal(youtubeSource('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(youtubeSource('https://youtube.com/watch?v=too-short'), null);
  assert.equal(youtubeSource('not a url'), null);
  assert.equal(youtubeSource(''), null);
});
