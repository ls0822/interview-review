---
id: q-4ba66f3f
type: qa
module: network
knowledge_ref: kp-crypto-basic
title: 对称 vs 非对称加密？摘要？
priority: P0
version: 1
---

## 问题
对称 vs 非对称加密？摘要？

## 答案
1. 对称：AES 等，快，密钥共享难。  
2. 非对称：RSA/ECC，公钥加密私钥解或签名验签。  
3. HTTPS：非对称/密钥交换 + 对称传数据。  
4. 摘要：MD5/SHA；完整性；密码存储要用慢哈希+盐（别只 MD5）。  
5. **挂钩**：离线包加密、上传 MD5 采样校验。

---
