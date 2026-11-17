/* 手机拍卷页的 Service Worker，放哪儿托管都同一份：
     电脑上：页面 /app、worker /sw.js
     GitHub Pages：页面 /仓库名/、worker /仓库名/sw.js
   页面注册时把自己所在的路径用 ?shell= 带进来，worker 存的就是这一份外壳，
   于是离线打开不再绑定某台机器或某个 IP。
   只干两件事：1) 存页面外壳，电脑没开机也能打开页面继续拍照排队列；
   2) 收到 sync 信号就叫页面续传（电脑重新开机时用）。
   /api/* 和跨源请求一律放行不缓存：批次、已收状态必须实时，照片本来也不经这里。 */
'use strict';

var SHELL = 'panduan-shell-v2';              // 和 _app.html 里的 SW_CACHE 得一致
var DIR = self.location.pathname.replace(/[^/]*$/, '');
var APP = new URLSearchParams(self.location.search).get('shell') || DIR;
var SYNC = 'pump';

var OFFLINE = '<!doctype html><meta charset=utf-8><meta name="viewport" ' +
  'content="width=device-width,initial-scale=1">' +
  '<body style="font-family:等线;padding:24px;line-height:1.8">' +
  '<h3>这台电脑现在连不上</h3>' +
  '<p>页面是上次存在手机里的，照片存在本机数据库，一张都不会丢。</p>' +
  '<p>先接着拍：拍完的卷子在「队列」里排着，回到电脑旁边连上就自动上传。' +
  '要是连页面都打不开，说明这台手机还没在线打开过本页——先在电脑上打开一次 ' +
  '「队列 → 取名单」那页，联网刷新一遍就有外壳了。</p>' +
  '<p style="color:#666">这期间别清浏览器数据，也别换地址：队列是按地址各存一份的。</p></body>';

self.addEventListener('install', function (e) {
  self.skipWaiting();
  /* 存不下外壳也要装成功：导航兜底页照样有用 */
  e.waitUntil(caches.open(SHELL).then(function (c) {
    return c.add(APP).catch(function () { return c.add(DIR); });
  }, function () { }).catch(function () { }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) {
      return k !== SHELL;
    }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var u = new URL(req.url);
  if (u.origin !== self.location.origin) return;             // 跨源直连电脑，交回浏览器
  if (u.pathname === self.location.pathname) return;         // worker 自己走网络，好更新
  if (u.pathname.indexOf('/api/') === 0) return;             // 实时状态一律现问
  if (u.pathname.indexOf(DIR) !== 0 || req.mode !== 'navigate') return;
  e.respondWith(fetch(new Request(req, { cache: 'reload' })).then(function (resp) {
    /* 克隆必须在这里同步做：等 caches.open 的回调跑完，body 已经被 respondWith 用掉了，
       那时再 clone 会抛 "body is already used"，缓存就永远停在第一次装的那份——
       页面改了手机也拿不到，只能等 sw.js 自己变字节重装。 */
    if (resp.ok && resp.type === 'basic') {
      var copy = resp.clone();
      caches.open(SHELL).then(function (c) { c.put(u.pathname, copy); }, function () { });
    }
    return resp;
  }, function () {
    return caches.open(SHELL).then(function (c) {
      return c.match(u.pathname).then(function (hit) { return hit || c.match(APP); });
    }).then(function (hit) {
      return hit || new Response(OFFLINE, {
        status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    });
  }));
});

self.addEventListener('sync', function (e) {
  if (e.tag !== SYNC) return;
  e.waitUntil(tell('pump'));
});

self.addEventListener('periodicsync', function (e) {
  if (e.tag !== SYNC) return;
  e.waitUntil(tell('pump'));
});

function tell(what) {
  return self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
    .then(function (list) {
      list.forEach(function (cl) { cl.postMessage({ what: what }); });
      return list.length;
    });
}
