const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

let db = {
    users: [
        { id: 1, username: "hassan", pin: "1234", name: "حسن أحمد (Hassan Ahmed)", email: "hassan@example.com", phone: "+966501234567", balance: 54320, role: "client", status: "Active", iban: "SA0380000000608010923841", cardType: "بلاتينية", cardNum: "**** **** **** 4821" },
        { id: 2, username: "mohamed", pin: "1234", name: "محمد علي (Mohamed Ali)", email: "mohamed@example.com", phone: "+966507654321", balance: 25000, role: "client", status: "Active", iban: "SA9280000000608010923842", cardType: "ذهبية", cardNum: "**** **** **** 9104" },
        { id: 4, username: "admin", pin: "admin123", name: "مدير النظام الرئيسي", email: "admin@bankalaman.sa", phone: "+966500000000", balance: 0, role: "admin", status: "Active", iban: "-", cardType: "-", cardNum: "-" }
    ],
    loans: [],
    transactions: [],
    auditLogs: [],
    pendingOtps: {}
};

function generateOtp() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// 1. تسجيل الدخول - طلب OTP
app.post('/api/auth/login-request', (req, res) => {
    const { username, pin } = req.body;
    const user = db.users.find(u => u.username === username && u.pin === pin);
    if (!user) {
        return res.status(401).json({ success: false, message: "اسم المستخدم أو الرمز السري غير صحيح." });
    }
    if (user.status === "Frozen" && user.role !== "admin") {
        return res.status(403).json({ success: false, message: "هذا الحساب مجمد من قبل الإدارة." });
    }

    const otp = generateOtp();
    db.pendingOtps[username] = { type: 'login', user, otp, expires: Date.now() + 180000 };

    res.json({
        success: true,
        requiresOtp: true,
        otpPreview: otp,
        message: `تم إرسال رمز التحقق (OTP) إلى جوال وبريد المستخدم ${user.name}`
    });
});

// تأكيد OTP تسجيل الدخول
app.post('/api/auth/login-verify', (req, res) => {
    const { username, otp } = req.body;
    const record = db.pendingOtps[username];
    if (!record || record.type !== 'login' || record.otp !== otp) {
        return res.status(400).json({ success: false, message: "رمز التحقق غير صحيح أو انتهت صلاحيته." });
    }

    delete db.pendingOtps[username];
    db.auditLogs.unshift({ time: new Date().toLocaleString(), action: "Login 2FA", details: `${record.user.name} logged in successfully.` });
    res.json({ success: true, user: record.user });
});

// 2. إنشاء حساب - طلب OTP
app.post('/api/auth/register-request', (req, res) => {
    const { name, username, email, phone, pin } = req.body;
    if (!name || !username || !pin) {
        return res.status(400).json({ success: false, message: "يرجى تعبئة كافة الحقول." });
    }
    if (db.users.find(u => u.username === username)) {
        return res.status(400).json({ success: false, message: "اسم المستخدم مستخدم مسبقاً." });
    }

    const otp = generateOtp();
    db.pendingOtps[username] = { type: 'register', data: { name, username, email, phone, pin }, otp, expires: Date.now() + 180000 };

    res.json({
        success: true,
        requiresOtp: true,
        otpPreview: otp,
        message: "تم إرسال رمز التحقق لتأكيد فتح الحساب الجديد."
    });
});

// تأكيد OTP إنشاء الحساب
app.post('/api/auth/register-verify', (req, res) => {
    const { username, otp } = req.body;
    const record = db.pendingOtps[username];
    if (!record || record.type !== 'register' || record.otp !== otp) {
        return res.status(400).json({ success: false, message: "رمز التحقق غير صحيح." });
    }

    const d = record.data;
    const newUser = {
        id: db.users.length + 1,
        username: d.username,
        pin: d.pin,
        name: d.name,
        email: d.email || `${d.username}@bankalaman.sa`,
        phone: d.phone || "+966500000000",
        balance: 1000,
        role: "client",
        status: "Active",
        iban: "SA" + Math.floor(100000000000000000000000 + Math.random() * 900000000000000000000000),
        cardType: "بلاتينية",
        cardNum: "**** **** **** " + Math.floor(1000 + Math.random() * 9000)
    };
    db.users.push(newUser);
    delete db.pendingOtps[username];

    db.auditLogs.unshift({ time: new Date().toLocaleString(), action: "New Account Verified", details: `New account created for ${newUser.name}` });
    res.json({ success: true, message: "تم التحقق وإنشاء الحساب بنجاح!", user: newUser });
});

// 3. التحويل المالي - طلب OTP
app.post('/api/transfer-request', (req, res) => {
    const { senderId, recipientIban, amount } = req.body;
    const sender = db.users.find(u => u.id == senderId);
    if (!sender || sender.balance < amount) {
        return res.status(400).json({ success: false, message: "الرصيد غير كافٍ أو المستخدم غير موجود." });
    }
    const recipient = db.users.find(u => u.iban === recipientIban || u.name.includes(recipientIban) || u.username === recipientIban);
    if (!recipient || recipient.id === sender.id) {
        return res.status(400).json({ success: false, message: "المستفيد غير صحيح أو غير مسموح التحويل لنفس الحساب." });
    }

    const otp = generateOtp();
    db.pendingOtps[sender.username] = { type: 'transfer', senderId, recipientId: recipient.id, recipientName: recipient.name, amount: parseFloat(amount), otp, expires: Date.now() + 180000 };

    res.json({
        success: true,
        requiresOtp: true,
        otpPreview: otp,
        message: `تم إرسال رمز التحقق (OTP) لإتمام تحويل مبلغ ${amount} SAR إلى ${recipient.name}`
    });
});

// تأكيد OTP التحويل المالي
app.post('/api/transfer-verify', (req, res) => {
    const { senderId, otp } = req.body;
    const sender = db.users.find(u => u.id == senderId);
    if (!sender) return res.status(400).json({ success: false, message: "خطأ في بيانات المرسل." });

    const record = db.pendingOtps[sender.username];
    if (!record || record.type !== 'transfer' || record.otp !== otp) {
        return res.status(400).json({ success: false, message: "رمز التحقق غير صحيح." });
    }

    const recipient = db.users.find(u => u.id == record.recipientId);
    sender.balance -= record.amount;
    recipient.balance += record.amount;

    db.transactions.unshift({
        senderId: sender.id,
        senderName: sender.name,
        recipientName: recipient.name,
        amount: record.amount,
        time: new Date().toLocaleString()
    });

    delete db.pendingOtps[sender.username];
    db.auditLogs.unshift({ time: new Date().toLocaleString(), action: "Transfer Verified & Executed", details: `Transferred ${record.amount} SAR from ${sender.name} to ${recipient.name}` });

    res.json({ success: true, message: "تم التحقق وتنفيذ الحوالة بنجاح!", newBalance: sender.balance });
});

// 4. طلب قرض أو خدمة - طلب OTP
app.post('/api/service-request', (req, res) => {
    const { clientId, serviceType, amount } = req.body;
    const client = db.users.find(u => u.id == clientId);
    if (!client) return res.status(400).json({ success: false, message: "المستخدم غير موجود." });

    const otp = generateOtp();
    db.pendingOtps[client.username] = { type: 'service', clientId, serviceType, amount: parseFloat(amount), otp, expires: Date.now() + 180000 };

    res.json({
        success: true,
        requiresOtp: true,
        otpPreview: otp,
        message: `رمز التحقق المطلوب لتقديم طلب (${serviceType}) بمبلغ ${amount} SAR`
    });
});

// تأكيد OTP القرض أو الخدمة
app.post('/api/service-verify', (req, res) => {
    const { clientId, otp } = req.body;
    const client = db.users.find(u => u.id == clientId);
    if (!client) return res.status(400).json({ success: false });

    const record = db.pendingOtps[client.username];
    if (!record || record.type !== 'service' || record.otp !== otp) {
        return res.status(400).json({ success: false, message: "رمز التحقق غير صحيح." });
    }

    db.loans.push({
        id: Date.now(),
        client: client.name,
        clientId: client.id,
        amount: record.amount,
        serviceType: record.serviceType,
        status: "Pending",
        creditScore: "A+"
    });

    delete db.pendingOtps[client.username];
    db.auditLogs.unshift({ time: new Date().toLocaleString(), action: "Service Request Verified", details: `${client.name} requested ${record.serviceType} of ${record.amount} SAR` });

    res.json({ success: true, message: "تم التحقق وتقديم الطلب بنجاح للإدارة للمراجعة والصرف!" });
});

// جلب بيانات المستخدم
app.get('/api/user/:id', (req, res) => {
    const user = db.users.find(u => u.id == req.params.id);
    if (!user) return res.status(404).json({ success: false });
    const userTx = db.transactions.filter(t => t.senderId == user.id);
    res.json({ success: true, user, transactions: userTx });
});

// بيانات الأدمن
app.get('/api/admin/data', (req, res) => {
    res.json({ success: true, db });
});

app.post('/api/admin/loan-action', (req, res) => {
    const { loanId, action } = req.body;
    const loan = db.loans.find(l => l.id == loanId);
    if (!loan) return res.status(404).json({ success: false });

    if (action === 'approve') {
        loan.status = "Approved";
        const client = db.users.find(u => u.id == loan.clientId);
        if (client) client.balance += loan.amount;
    } else {
        loan.status = "Rejected";
    }
    res.json({ success: true });
});

app.post('/api/admin/toggle-user', (req, res) => {
    const { userId } = req.body;
    const user = db.users.find(u => u.id == userId);
    if (user && user.role !== 'admin') {
        user.status = user.status === 'Active' ? 'Frozen' : 'Active';
    }
    res.json({ success: true, user });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bank Al-Aman running on port ${PORT}`));
