# 支付与会员接口

## 套餐目录

- `GET /api/payments/plans`：公开返回当前在售套餐、当前生效报价、支付通道可用状态以及部署是否要求支付验证码。
- `GET /api/admin/payments/plans`：管理员查看全部在售/停售套餐和已配置的限时优惠。
- `PUT /api/admin/payments/plans/:planId`：管理员修改套餐。支持 `name`、`amountCents`、`credits`、`durationDays`、`features`、`saleable` 和可选 `promotion`；使用 `expectedUpdatedAt` 防止覆盖另一位管理员刚保存的版本。

`promotion` 结构为：

```json
{
  "label": "开学季优惠",
  "amountCents": 2900,
  "startsAt": "2026-08-05T00:00:00.000Z",
  "endsAt": "2026-08-20T00:00:00.000Z"
}
```

优惠价必须低于原价，只在 `startsAt <= 当前时间 < endsAt` 时成为服务端成交价。传 `null` 可清除优惠。独立优惠码、分群、次数限制和叠加规则不属于这个直减模型，当前未接入。

## 用户结算

生产环境默认先调用 `POST /api/auth/verification-codes`，参数为当前登录账号和 `purpose: "checkout"`。创建订单时：

```http
POST /api/payments/orders
Idempotency-Key: checkout:客户端生成的唯一值
Content-Type: application/json
```

```json
{
  "provider": "wechat",
  "planId": "pro-monthly",
  "amountCents": 3900,
  "verificationId": "vfy_...",
  "verificationCode": "123456"
}
```

`amountCents` 仅用于发现页面报价过期，真正金额与权益始终由服务端套餐目录决定。同一个用户、通道和幂等键的重试返回原订单；同一幂等键改成其他参数会返回冲突。

- 微信返回 `wechat_native_qr` 和 `codeUrl`，前端本地生成二维码。
- 支付宝返回 `alipay_page_form`、官方网关地址和已签名字段，前端以 POST 表单跳转。
- `GET /api/payments/orders/:orderId` 只允许订单所属用户查询，可轮询 `status` 与 `fulfillment.status`。

只有 `status=PAID` 且 `fulfillment.status=FULFILLED` 才代表付款与会员权益均完成。`PAID + RETRY_REQUIRED` 表示网关付款已确认但权益存储需要回调重试，客户端必须提示“权益处理中”，不能要求用户重复付款。

## 回调和权益

- `POST /api/payments/notify/wechat`：验证微信支付签名、时间戳、公钥/证书序列号，解密 API v3 资源，再核对 AppID、商户号、金额与币种。
- `POST /api/payments/notify/alipay`：按 RSA2 验签并核对 AppID、卖家 ID、订单号和总金额。

通知事件 ID 和权益订单 ID 都做幂等。权益包括会员等级、有效期和一次性发放点数；权益内容来自下单时保存的服务端快照，而不是回调或浏览器参数。当前不计算升级/降级差价，任何新会员权益都会从已有最后一段付费权益到期后排队生效，以保证已购买天数不丢失。

## 正式上线仍需商户资料完成的事项

代码无法替代微信/支付宝的企业认证、产品签约、应用审核、公钥/证书轮换以及公网 HTTPS 回调联调。主动查单、日终对账、关单、退款、退款通知、发票和拒付处理仍需在真实商户测试环境中完成后才能宣称支持；当前后台不会伪造这些结果。
