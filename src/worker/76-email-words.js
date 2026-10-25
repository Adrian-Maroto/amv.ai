/* ══════════════════════════════════════════════════════════════════════════
   THE EMAILS SOMEBODY CANNOT USE AMV WITHOUT, IN THEIR LANGUAGE.

   The sign-in code and the password reset code are the first thing AMV ever
   sends a person, and the one thing they must read to get in. They were
   English in all seventeen languages AMV speaks - so the first impression for
   most of the world was a message in a language they may not read, carrying a
   code and a warning ("never share this code") they could not understand.

   The language is the one the page is in (`lang` in the body of the sign-in
   and reset requests), else the browser's own (Accept-Language), else
   English. In the body, not a header: a custom header has to be allowed by
   every server the page might reach, and a page newer than its server would
   have failed every request. Only these two emails
   for now: they decide whether somebody gets in at all.
   ══════════════════════════════════════════════════════════════════════════ */
const EMAIL_LANGS = new Set(['en', 'es', 'zh', 'hi', 'ar', 'pt', 'fr', 'de', 'ja', 'ru', 'id', 'bn', 'ur', 'tr', 'vi', 'it', 'ko', 'ta']);
const EMAIL_RTL = new Set(['ar', 'ur']);
function _emailLang(request, said) {
  try {
    const s = String(said || '').toLowerCase().trim();
    if (EMAIL_LANGS.has(s)) return s;
    const al = String((request && request.headers.get('Accept-Language')) || '');
    for (const part of al.split(',')) {
      const tag = part.split(';')[0].trim().toLowerCase().split('-')[0];
      if (EMAIL_LANGS.has(tag)) return tag;
    }
  } catch (e) {}
  return 'en';
}
const EMAIL_WORDS = {
 "code.subject": {
  "en": "Your AMV code: {code}",
  "es": "Tu código de AMV: {code}",
  "zh": "你的 AMV 验证码：{code}",
  "hi": "आपका AMV कोड: {code}",
  "ar": "رمز AMV الخاص بك: {code}",
  "pt": "Seu código do AMV: {code}",
  "fr": "Votre code AMV : {code}",
  "de": "Dein AMV-Code: {code}",
  "ja": "AMV の確認コード：{code}",
  "ru": "Ваш код AMV: {code}",
  "id": "Kode AMV Anda: {code}",
  "bn": "আপনার AMV কোড: {code}",
  "ur": "آپ کا AMV کوڈ: {code}",
  "tr": "AMV kodunuz: {code}",
  "vi": "Mã AMV của bạn: {code}",
  "it": "Il tuo codice AMV: {code}",
  "ko": "AMV 코드: {code}",
  "ta": "உங்கள் AMV குறியீடு: {code}"
 },
 "code.title.signup": {
  "en": "Confirm your email",
  "es": "Confirma tu correo",
  "zh": "确认你的邮箱",
  "hi": "अपना ईमेल पुष्टि करें",
  "ar": "أكّد بريدك الإلكتروني",
  "pt": "Confirme seu e-mail",
  "fr": "Confirmez votre adresse e-mail",
  "de": "Bestätige deine E-Mail-Adresse",
  "ja": "メールアドレスの確認",
  "ru": "Подтвердите адрес почты",
  "id": "Konfirmasi email Anda",
  "bn": "আপনার ইমেল নিশ্চিত করুন",
  "ur": "اپنی ای میل کی تصدیق کریں",
  "tr": "E-postanızı doğrulayın",
  "vi": "Xác nhận email của bạn",
  "it": "Conferma la tua email",
  "ko": "이메일을 확인하세요",
  "ta": "உங்கள் மின்னஞ்சலை உறுதிப்படுத்தவும்"
 },
 "code.title.signin": {
  "en": "Your sign-in code",
  "es": "Tu código de inicio de sesión",
  "zh": "你的登录验证码",
  "hi": "आपका साइन-इन कोड",
  "ar": "رمز تسجيل الدخول",
  "pt": "Seu código de acesso",
  "fr": "Votre code de connexion",
  "de": "Dein Anmeldecode",
  "ja": "サインイン用コード",
  "ru": "Ваш код для входа",
  "id": "Kode masuk Anda",
  "bn": "আপনার সাইন-ইন কোড",
  "ur": "آپ کا سائن اِن کوڈ",
  "tr": "Giriş kodunuz",
  "vi": "Mã đăng nhập của bạn",
  "it": "Il tuo codice di accesso",
  "ko": "로그인 코드",
  "ta": "உங்கள் உள்நுழைவு குறியீடு"
 },
 "code.line.signup": {
  "en": "Enter this code to finish creating your AMV account.",
  "es": "Introduce este código para terminar de crear tu cuenta de AMV.",
  "zh": "输入此验证码以完成 AMV 账户的创建。",
  "hi": "अपना AMV खाता बनाना पूरा करने के लिए यह कोड दर्ज करें।",
  "ar": "أدخل هذا الرمز لإكمال إنشاء حسابك في AMV.",
  "pt": "Digite este código para concluir a criação da sua conta do AMV.",
  "fr": "Saisissez ce code pour finir de créer votre compte AMV.",
  "de": "Gib diesen Code ein, um dein AMV-Konto fertig einzurichten.",
  "ja": "このコードを入力して AMV アカウントの作成を完了してください。",
  "ru": "Введите этот код, чтобы завершить создание аккаунта AMV.",
  "id": "Masukkan kode ini untuk menyelesaikan pembuatan akun AMV Anda.",
  "bn": "আপনার AMV অ্যাকাউন্ট তৈরি শেষ করতে এই কোডটি লিখুন।",
  "ur": "اپنا AMV اکاؤنٹ بنانا مکمل کرنے کے لیے یہ کوڈ درج کریں۔",
  "tr": "AMV hesabınızı oluşturmayı tamamlamak için bu kodu girin.",
  "vi": "Nhập mã này để hoàn tất việc tạo tài khoản AMV.",
  "it": "Inserisci questo codice per completare la creazione del tuo account AMV.",
  "ko": "이 코드를 입력해 AMV 계정 만들기를 완료하세요.",
  "ta": "உங்கள் AMV கணக்கை உருவாக்கி முடிக்க இந்தக் குறியீட்டை உள்ளிடவும்."
 },
 "code.line.signin": {
  "en": "Enter this code to finish signing in to AMV on a new device.",
  "es": "Introduce este código para terminar de iniciar sesión en AMV en un dispositivo nuevo.",
  "zh": "输入此验证码以在新设备上完成 AMV 登录。",
  "hi": "नए डिवाइस पर AMV में साइन इन पूरा करने के लिए यह कोड दर्ज करें।",
  "ar": "أدخل هذا الرمز لإكمال تسجيل الدخول إلى AMV على جهاز جديد.",
  "pt": "Digite este código para concluir o acesso ao AMV em um novo dispositivo.",
  "fr": "Saisissez ce code pour finir de vous connecter à AMV sur un nouvel appareil.",
  "de": "Gib diesen Code ein, um die Anmeldung bei AMV auf einem neuen Gerät abzuschließen.",
  "ja": "このコードを入力して、新しいデバイスでの AMV へのサインインを完了してください。",
  "ru": "Введите этот код, чтобы завершить вход в AMV на новом устройстве.",
  "id": "Masukkan kode ini untuk menyelesaikan masuk ke AMV di perangkat baru.",
  "bn": "নতুন ডিভাইসে AMV-তে সাইন ইন শেষ করতে এই কোডটি লিখুন।",
  "ur": "نئی ڈیوائس پر AMV میں سائن اِن مکمل کرنے کے لیے یہ کوڈ درج کریں۔",
  "tr": "Yeni bir cihazda AMV’ye girişi tamamlamak için bu kodu girin.",
  "vi": "Nhập mã này để hoàn tất đăng nhập AMV trên thiết bị mới.",
  "it": "Inserisci questo codice per completare l’accesso ad AMV su un nuovo dispositivo.",
  "ko": "새 기기에서 AMV 로그인을 완료하려면 이 코드를 입력하세요.",
  "ta": "புதிய சாதனத்தில் AMV-இல் உள்நுழைவதை முடிக்க இந்தக் குறியீட்டை உள்ளிடவும்."
 },
 "code.expires": {
  "en": "It expires in 10 minutes and works once.",
  "es": "Caduca en 10 minutos y solo funciona una vez.",
  "zh": "验证码 10 分钟内有效，仅可使用一次。",
  "hi": "यह 10 मिनट में समाप्त हो जाएगा और केवल एक बार काम करेगा।",
  "ar": "تنتهي صلاحيته خلال 10 دقائق ويعمل مرة واحدة.",
  "pt": "Ele expira em 10 minutos e funciona uma única vez.",
  "fr": "Il expire dans 10 minutes et ne fonctionne qu’une fois.",
  "de": "Er läuft in 10 Minuten ab und funktioniert nur einmal.",
  "ja": "有効期限は 10 分で、1 回だけ使えます。",
  "ru": "Код действует 10 минут и срабатывает один раз.",
  "id": "Kode ini kedaluwarsa dalam 10 menit dan hanya berlaku sekali.",
  "bn": "এটি ১০ মিনিটে মেয়াদোত্তীর্ণ হবে এবং একবারই কাজ করবে।",
  "ur": "یہ 10 منٹ میں ختم ہو جائے گا اور صرف ایک بار کام کرے گا۔",
  "tr": "10 dakika içinde geçerliliğini yitirir ve yalnızca bir kez kullanılabilir.",
  "vi": "Mã hết hạn sau 10 phút và chỉ dùng được một lần.",
  "it": "Scade tra 10 minuti e funziona una sola volta.",
  "ko": "10분 후 만료되며 한 번만 사용할 수 있습니다.",
  "ta": "இது 10 நிமிடங்களில் காலாவதியாகும், ஒருமுறை மட்டுமே செயல்படும்."
 },
 "code.ignore.signup": {
  "en": "If you did not try to create an account, you can ignore this email - nothing happens without the code.",
  "es": "Si no intentaste crear una cuenta, puedes ignorar este correo: no pasa nada sin el código.",
  "zh": "如果你没有尝试创建账户，可以忽略此邮件——没有验证码就不会发生任何事。",
  "hi": "अगर आपने खाता बनाने की कोशिश नहीं की, तो इस ईमेल को अनदेखा करें - कोड के बिना कुछ नहीं होगा।",
  "ar": "إذا لم تحاول إنشاء حساب، يمكنك تجاهل هذه الرسالة - لا يحدث شيء دون الرمز.",
  "pt": "Se você não tentou criar uma conta, pode ignorar este e-mail - nada acontece sem o código.",
  "fr": "Si vous n’avez pas essayé de créer un compte, ignorez cet e-mail : rien ne se passe sans le code.",
  "de": "Wenn du kein Konto erstellen wolltest, kannst du diese E-Mail ignorieren - ohne den Code passiert nichts.",
  "ja": "アカウントを作成しようとしていない場合は、このメールを無視してください。コードがなければ何も起きません。",
  "ru": "Если вы не пытались создать аккаунт, просто проигнорируйте это письмо - без кода ничего не произойдёт.",
  "id": "Jika Anda tidak mencoba membuat akun, abaikan email ini - tidak ada yang terjadi tanpa kode.",
  "bn": "আপনি অ্যাকাউন্ট তৈরির চেষ্টা না করে থাকলে এই ইমেলটি উপেক্ষা করুন - কোড ছাড়া কিছুই হবে না।",
  "ur": "اگر آپ نے اکاؤنٹ بنانے کی کوشش نہیں کی تو اس ای میل کو نظر انداز کریں - کوڈ کے بغیر کچھ نہیں ہوگا۔",
  "tr": "Hesap oluşturmayı denemediyseniz bu e-postayı yok sayabilirsiniz - kod olmadan hiçbir şey olmaz.",
  "vi": "Nếu bạn không định tạo tài khoản, hãy bỏ qua email này - không có mã thì không có gì xảy ra.",
  "it": "Se non hai provato a creare un account, puoi ignorare questa email: senza il codice non succede nulla.",
  "ko": "계정을 만들려고 하지 않았다면 이 메일은 무시하세요. 코드 없이는 아무 일도 일어나지 않습니다.",
  "ta": "நீங்கள் கணக்கை உருவாக்க முயலவில்லை எனில் இந்த மின்னஞ்சலைப் புறக்கணிக்கலாம் - குறியீடு இல்லாமல் எதுவும் நடக்காது."
 },
 "code.ignore.signin": {
  "en": "If this was not you, somebody knows your password: change it now, and nothing happens without this code.",
  "es": "Si no fuiste tú, alguien conoce tu contraseña: cámbiala ahora. Sin este código no pasa nada.",
  "zh": "如果这不是你本人，说明有人知道你的密码：请立即修改。没有此验证码就不会发生任何事。",
  "hi": "अगर यह आप नहीं थे, तो किसी को आपका पासवर्ड पता है: इसे अभी बदलें। इस कोड के बिना कुछ नहीं होगा।",
  "ar": "إذا لم تكن أنت، فهناك من يعرف كلمة مرورك: غيّرها الآن، ولن يحدث شيء دون هذا الرمز.",
  "pt": "Se não foi você, alguém sabe sua senha: altere-a agora. Nada acontece sem este código.",
  "fr": "Si ce n’était pas vous, quelqu’un connaît votre mot de passe : changez-le maintenant. Rien ne se passe sans ce code.",
  "de": "Wenn du das nicht warst, kennt jemand dein Passwort: Ändere es jetzt. Ohne diesen Code passiert nichts.",
  "ja": "心当たりがない場合、誰かがあなたのパスワードを知っています。今すぐ変更してください。このコードがなければ何も起きません。",
  "ru": "Если это были не вы, кто-то знает ваш пароль: смените его сейчас. Без этого кода ничего не произойдёт.",
  "id": "Jika ini bukan Anda, seseorang mengetahui kata sandi Anda: segera ganti. Tanpa kode ini tidak ada yang terjadi.",
  "bn": "এটি আপনি না হলে কেউ আপনার পাসওয়ার্ড জানে: এখনই এটি পরিবর্তন করুন। এই কোড ছাড়া কিছুই হবে না।",
  "ur": "اگر یہ آپ نہیں تھے تو کسی کو آپ کا پاس ورڈ معلوم ہے: ابھی اسے بدلیں۔ اس کوڈ کے بغیر کچھ نہیں ہوگا۔",
  "tr": "Bu siz değilseniz biri şifrenizi biliyor: hemen değiştirin. Bu kod olmadan hiçbir şey olmaz.",
  "vi": "Nếu không phải bạn, ai đó đã biết mật khẩu của bạn: hãy đổi ngay. Không có mã này thì không có gì xảy ra.",
  "it": "Se non sei stato tu, qualcuno conosce la tua password: cambiala ora. Senza questo codice non succede nulla.",
  "ko": "본인이 아니라면 누군가 비밀번호를 알고 있습니다. 지금 변경하세요. 이 코드 없이는 아무 일도 일어나지 않습니다.",
  "ta": "இது நீங்கள் இல்லை என்றால், யாரோ உங்கள் கடவுச்சொல்லை அறிந்துள்ளார்: இப்போதே மாற்றவும். இந்தக் குறியீடு இல்லாமல் எதுவும் நடக்காது."
 },
 "code.never": {
  "en": "Never share this code. AMV will never ask you for it.",
  "es": "Nunca compartas este código. AMV nunca te lo pedirá.",
  "zh": "切勿分享此验证码。AMV 绝不会向你索要。",
  "hi": "यह कोड कभी साझा न करें। AMV आपसे यह कभी नहीं माँगेगा।",
  "ar": "لا تشارك هذا الرمز أبدًا. لن يطلبه AMV منك أبدًا.",
  "pt": "Nunca compartilhe este código. O AMV nunca vai pedi-lo.",
  "fr": "Ne partagez jamais ce code. AMV ne vous le demandera jamais.",
  "de": "Teile diesen Code niemals. AMV wird dich nie danach fragen.",
  "ja": "このコードは誰にも教えないでください。AMV がコードを尋ねることはありません。",
  "ru": "Никому не сообщайте этот код. AMV никогда его не попросит.",
  "id": "Jangan pernah membagikan kode ini. AMV tidak akan pernah memintanya.",
  "bn": "এই কোড কখনও কাউকে দেবেন না। AMV কখনও এটি চাইবে না।",
  "ur": "یہ کوڈ کبھی کسی کو نہ بتائیں۔ AMV آپ سے یہ کبھی نہیں مانگے گا۔",
  "tr": "Bu kodu asla paylaşmayın. AMV bunu sizden asla istemez.",
  "vi": "Đừng bao giờ chia sẻ mã này. AMV sẽ không bao giờ hỏi bạn mã này.",
  "it": "Non condividere mai questo codice. AMV non te lo chiederà mai.",
  "ko": "이 코드를 절대 공유하지 마세요. AMV는 코드를 요청하지 않습니다.",
  "ta": "இந்தக் குறியீட்டை யாருடனும் பகிர வேண்டாம். AMV ஒருபோதும் இதைக் கேட்காது."
 },
 "reset.subject": {
  "en": "Your AMV password reset code",
  "es": "Tu código para restablecer la contraseña de AMV",
  "zh": "你的 AMV 密码重置验证码",
  "hi": "आपका AMV पासवर्ड रीसेट कोड",
  "ar": "رمز إعادة تعيين كلمة مرور AMV",
  "pt": "Seu código para redefinir a senha do AMV",
  "fr": "Votre code de réinitialisation du mot de passe AMV",
  "de": "Dein Code zum Zurücksetzen des AMV-Passworts",
  "ja": "AMV パスワード再設定コード",
  "ru": "Код для сброса пароля AMV",
  "id": "Kode atur ulang kata sandi AMV Anda",
  "bn": "আপনার AMV পাসওয়ার্ড রিসেট কোড",
  "ur": "آپ کا AMV پاس ورڈ ری سیٹ کوڈ",
  "tr": "AMV şifre sıfırlama kodunuz",
  "vi": "Mã đặt lại mật khẩu AMV của bạn",
  "it": "Il tuo codice per reimpostare la password AMV",
  "ko": "AMV 비밀번호 재설정 코드",
  "ta": "உங்கள் AMV கடவுச்சொல் மீட்டமைப்புக் குறியீடு"
 },
 "reset.title": {
  "en": "Your reset code",
  "es": "Tu código de restablecimiento",
  "zh": "你的重置验证码",
  "hi": "आपका रीसेट कोड",
  "ar": "رمز إعادة التعيين",
  "pt": "Seu código de redefinição",
  "fr": "Votre code de réinitialisation",
  "de": "Dein Code zum Zurücksetzen",
  "ja": "再設定コード",
  "ru": "Ваш код для сброса",
  "id": "Kode atur ulang Anda",
  "bn": "আপনার রিসেট কোড",
  "ur": "آپ کا ری سیٹ کوڈ",
  "tr": "Sıfırlama kodunuz",
  "vi": "Mã đặt lại của bạn",
  "it": "Il tuo codice di reimpostazione",
  "ko": "재설정 코드",
  "ta": "உங்கள் மீட்டமைப்புக் குறியீடு"
 },
 "reset.line": {
  "en": "Enter this code in AMV to set a new password. It expires in 15 minutes.",
  "es": "Introduce este código en AMV para crear una contraseña nueva. Caduca en 15 minutos.",
  "zh": "在 AMV 中输入此验证码以设置新密码。验证码 15 分钟内有效。",
  "hi": "नया पासवर्ड सेट करने के लिए यह कोड AMV में दर्ज करें। यह 15 मिनट में समाप्त हो जाएगा।",
  "ar": "أدخل هذا الرمز في AMV لتعيين كلمة مرور جديدة. تنتهي صلاحيته خلال 15 دقيقة.",
  "pt": "Digite este código no AMV para definir uma nova senha. Ele expira em 15 minutos.",
  "fr": "Saisissez ce code dans AMV pour définir un nouveau mot de passe. Il expire dans 15 minutes.",
  "de": "Gib diesen Code in AMV ein, um ein neues Passwort festzulegen. Er läuft in 15 Minuten ab.",
  "ja": "AMV でこのコードを入力して新しいパスワードを設定してください。有効期限は 15 分です。",
  "ru": "Введите этот код в AMV, чтобы задать новый пароль. Он действует 15 минут.",
  "id": "Masukkan kode ini di AMV untuk membuat kata sandi baru. Kode kedaluwarsa dalam 15 menit.",
  "bn": "নতুন পাসওয়ার্ড সেট করতে AMV-তে এই কোডটি লিখুন। এটি ১৫ মিনিটে মেয়াদোত্তীর্ণ হবে।",
  "ur": "نیا پاس ورڈ سیٹ کرنے کے لیے یہ کوڈ AMV میں درج کریں۔ یہ 15 منٹ میں ختم ہو جائے گا۔",
  "tr": "Yeni bir şifre belirlemek için bu kodu AMV’ye girin. 15 dakika içinde geçerliliğini yitirir.",
  "vi": "Nhập mã này vào AMV để đặt mật khẩu mới. Mã hết hạn sau 15 phút.",
  "it": "Inserisci questo codice in AMV per impostare una nuova password. Scade tra 15 minuti.",
  "ko": "AMV에 이 코드를 입력해 새 비밀번호를 설정하세요. 15분 후 만료됩니다.",
  "ta": "புதிய கடவுச்சொல்லை அமைக்க இந்தக் குறியீட்டை AMV-இல் உள்ளிடவும். இது 15 நிமிடங்களில் காலாவதியாகும்."
 },
 "reset.ignore": {
  "en": "If you didn’t request this, you can ignore this email - your password won’t change.",
  "es": "Si no lo solicitaste, puedes ignorar este correo: tu contraseña no cambiará.",
  "zh": "如果不是你本人请求的，可以忽略此邮件——你的密码不会改变。",
  "hi": "अगर आपने यह अनुरोध नहीं किया, तो इस ईमेल को अनदेखा करें - आपका पासवर्ड नहीं बदलेगा।",
  "ar": "إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة - لن تتغير كلمة مرورك.",
  "pt": "Se você não pediu isso, pode ignorar este e-mail - sua senha não vai mudar.",
  "fr": "Si vous n’en êtes pas à l’origine, ignorez cet e-mail : votre mot de passe ne changera pas.",
  "de": "Wenn du das nicht angefordert hast, kannst du diese E-Mail ignorieren - dein Passwort bleibt gleich.",
  "ja": "心当たりがない場合は、このメールを無視してください。パスワードは変更されません。",
  "ru": "Если вы этого не запрашивали, проигнорируйте письмо - пароль не изменится.",
  "id": "Jika Anda tidak memintanya, abaikan email ini - kata sandi Anda tidak akan berubah.",
  "bn": "আপনি এটি অনুরোধ না করে থাকলে এই ইমেলটি উপেক্ষা করুন - আপনার পাসওয়ার্ড বদলাবে না।",
  "ur": "اگر آپ نے یہ درخواست نہیں کی تو اس ای میل کو نظر انداز کریں - آپ کا پاس ورڈ نہیں بدلے گا۔",
  "tr": "Bunu siz istemediyseniz bu e-postayı yok sayabilirsiniz - şifreniz değişmez.",
  "vi": "Nếu bạn không yêu cầu, hãy bỏ qua email này - mật khẩu của bạn sẽ không thay đổi.",
  "it": "Se non l’hai richiesto, puoi ignorare questa email: la tua password non cambierà.",
  "ko": "요청하지 않았다면 이 메일은 무시하세요. 비밀번호는 바뀌지 않습니다.",
  "ta": "நீங்கள் இதைக் கோரவில்லை எனில் இந்த மின்னஞ்சலைப் புறக்கணிக்கலாம் - உங்கள் கடவுச்சொல் மாறாது."
 },
 "reset.footnote": {
  "en": "This is an automated security email.",
  "es": "Este es un correo de seguridad automático.",
  "zh": "这是一封自动发送的安全邮件。",
  "hi": "यह एक स्वचालित सुरक्षा ईमेल है।",
  "ar": "هذه رسالة أمان تلقائية.",
  "pt": "Este é um e-mail de segurança automático.",
  "fr": "Ceci est un e-mail de sécurité automatique.",
  "de": "Dies ist eine automatische Sicherheits-E-Mail.",
  "ja": "これは自動送信のセキュリティメールです。",
  "ru": "Это автоматическое письмо системы безопасности.",
  "id": "Ini adalah email keamanan otomatis.",
  "bn": "এটি একটি স্বয়ংক্রিয় নিরাপত্তা ইমেল।",
  "ur": "یہ ایک خودکار سیکیورٹی ای میل ہے۔",
  "tr": "Bu otomatik bir güvenlik e-postasıdır.",
  "vi": "Đây là email bảo mật tự động.",
  "it": "Questa è un’email di sicurezza automatica.",
  "ko": "자동으로 발송된 보안 메일입니다.",
  "ta": "இது ஒரு தானியங்கி பாதுகாப்பு மின்னஞ்சல்."
 }
};
function _ew(lang, key, vars) {
  const e = EMAIL_WORDS[key] || {};
  let s = e[lang] || e.en || '';
  for (const k of Object.keys(vars || {})) s = s.split('{' + k + '}').join(String(vars[k]));
  return s;
}
