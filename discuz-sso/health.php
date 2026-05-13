<?php
// SSO 密钥指纹健康检查（仅返回指纹，不泄漏明文）
// 与 Node 端 /api/sso/health 使用相同算法 sha256(secret) 前 16 位

// 必须切到 Discuz 根目录，才能读到 config_global.php 里的 DISCUZ_SSO_SECRET 常量
$discuz_root = dirname(__DIR__);
chdir($discuz_root);

// 直接 require config_global.php 拿常量（不需要完整 init）
$cfg = $discuz_root . '/config/config_global.php';
if (file_exists($cfg)) {
    @include_once $cfg;
}

$SSO_SECRET = defined('DISCUZ_SSO_SECRET') ? DISCUZ_SSO_SECRET : (getenv('JWT_SECRET') ?: '');

header('Content-Type: application/json; charset=utf-8');
echo json_encode([
    'hasSecret' => $SSO_SECRET !== '',
    'length' => strlen($SSO_SECRET),
    'fingerprint' => $SSO_SECRET ? substr(hash('sha256', $SSO_SECRET), 0, 16) : '',
    'source' => defined('DISCUZ_SSO_SECRET') ? 'const' : (getenv('JWT_SECRET') ? 'env' : 'missing'),
], JSON_UNESCAPED_UNICODE);
