/* ============================================================
   AMV UI TRANSLATION DICTIONARY
   Covers the core UI vocabulary in all 19 supported languages so
   the interface switches fully WITHOUT needing an API key. Keys are
   the exact English UI strings; each value maps lang-code → translation.
   Order of languages per entry:
   es zh hi ar pt fr de ja ru id bn ur tr vi it ko ta
   (en/auto use the key itself.)
   Merged into the runtime I18N object at load.
   ============================================================ */
(function(){
  // helper: build an entry from a positional array
  const L = ['es','zh','hi','ar','pt','fr','de','ja','ru','id','bn','ur','tr','vi','it','ko','ta'];
  function E(){ const a=arguments; const o={}; for(let i=0;i<L.length;i++){ if(a[i]) o[L[i]]=a[i]; } return o; }

  const D = {
    // ---- Primary navigation ----
    'Chat':            E('Chat','聊天','चैट','الدردشة','Conversa','Discussion','Chat','チャット','Чат','Obrolan','চ্যাট','چیٹ','Sohbet','Trò chuyện','Chat','채팅','அரட்டை'),
    'Images':          E('Imágenes','图片','छवियाँ','الصور','Imagens','Images','Bilder','画像','Изображения','Gambar','ছবি','تصاویر','Görseller','Hình ảnh','Immagini','이미지','படங்கள்'),
    'Video':           E('Vídeo','视频','वीडियो','الفيديو','Vídeo','Vidéo','Video','動画','Видео','Video','ভিডিও','ویڈیو','Video','Video','Video','비디오','வீடியோ'),
    'Crew':            E('Equipo','团队','दल','الطاقم','Equipe','Équipe','Team','クルー','Команда','Kru','ক্রু','عملہ','Ekip','Nhóm','Squadra','크루','குழு'),
    'Handoff':         E('Transferir','交接','सौंपना','التسليم','Transferir','Transfert','Übergabe','引き継ぎ','Передача','Serah','হস্তান্তর','حوالگی','Devir','Bàn giao','Passaggio','핸드오프','ஒப்படைப்பு'),
    'Studio':          E('Estudio','工作室','स्टूडियो','الاستوديو','Estúdio','Studio','Studio','スタジオ','Студия','Studio','স্টুডিও','اسٹوڈیو','Stüdyo','Studio','Studio','스튜디오','ஸ்டுடியோ'),
    'Dev':             E('Dev','开发','डेव','المطور','Dev','Dev','Dev','開発','Разработка','Dev','ডেভ','ڈیو','Dev','Dev','Dev','개발','டெவ்'),
    'Lab':             E('Laboratorio','实验室','लैब','المختبر','Laboratório','Labo','Labor','ラボ','Лаборатория','Lab','ল্যাব','لیب','Lab','Phòng thí nghiệm','Laboratorio','랩','ஆய்வகம்'),
    'Projects':        E('Proyectos','项目','परियोजनाएँ','المشاريع','Projetos','Projets','Projekte','プロジェクト','Проекты','Proyek','প্রকল্প','منصوبے','Projeler','Dự án','Progetti','프로젝트','திட்டங்கள்'),
    'Memory':          E('Memoria','记忆','स्मृति','الذاكرة','Memória','Mémoire','Speicher','メモリ','Память','Memori','স্মৃতি','یادداشت','Bellek','Bộ nhớ','Memoria','메모리','நினைவகம்'),
    'Tasks':           E('Tareas','任务','कार्य','المهام','Tarefas','Tâches','Aufgaben','タスク','Задачи','Tugas','কাজ','کام','Görevler','Nhiệm vụ','Attività','작업','பணிகள்'),
    'Marketplace':     E('Mercado','市场','मार्केटप्लेस','السوق','Mercado','Marché','Marktplatz','マーケット','Маркет','Pasar','মার্কেটপ্লেস','مارکیٹ','Pazar','Chợ','Mercato','마켓플레이스','சந்தை'),
    'Plans':           E('Planes','套餐','योजनाएँ','الخطط','Planos','Forfaits','Tarife','プラン','Тарифы','Paket','প্ল্যান','منصوبے','Planlar','Gói','Piani','요금제','திட்டங்கள்'),

    // ---- Section eyebrows ----
    'Create':          E('Crear','创作','बनाएँ','إنشاء','Criar','Créer','Erstellen','作成','Создать','Buat','তৈরি করুন','بنائیں','Oluştur','Tạo','Crea','만들기','உருவாக்கு'),
    'Agents':          E('Agentes','智能体','एजेंट','الوكلاء','Agentes','Agents','Agenten','エージェント','Агенты','Agen','এজেন্ট','ایجنٹس','Ajanlar','Tác nhân','Agenti','에이전트','முகவர்கள்'),
    'Build':           E('Construir','构建','निर्माण','بناء','Construir','Construire','Erstellen','ビルド','Сборка','Bangun','নির্মাণ','تعمیر','Oluştur','Xây dựng','Costruisci','빌드','உருவாக்கு'),
    'Workspace':       E('Espacio','工作区','कार्यस्थान','مساحة العمل','Espaço','Espace','Arbeitsbereich','ワークスペース','Рабочая область','Ruang kerja','কর্মক্ষেত্র','ورک اسپیس','Çalışma alanı','Không gian làm việc','Area di lavoro','작업 공간','பணியிடம்'),
    'Recents':         E('Recientes','最近','हाल के','الأخيرة','Recentes','Récents','Kürzlich','最近','Недавние','Terbaru','সাম্প্রতিক','حالیہ','Son kullanılanlar','Gần đây','Recenti','최근','சமீபத்தியவை'),
    'General':         E('General','通用','सामान्य','عام','Geral','Général','Allgemein','一般','Общие','Umum','সাধারণ','عام','Genel','Chung','Generale','일반','பொது'),
    'Customize':       E('Personalizar','自定义','अनुकूलित','تخصيص','Personalizar','Personnaliser','Anpassen','カスタマイズ','Настроить','Sesuaikan','কাস্টমাইজ','حسب ضرورت','Özelleştir','Tùy chỉnh','Personalizza','맞춤 설정','தனிப்பயனாக்கு'),

    // ---- Common actions / buttons ----
    'New chat':        E('Nueva conversación','新对话','नई चैट','محادثة جديدة','Nova conversa','Nouvelle discussion','Neuer Chat','新しいチャット','Новый чат','Obrolan baru','নতুন চ্যাট','نئی چیٹ','Yeni sohbet','Trò chuyện mới','Nuova chat','새 채팅','புதிய அரட்டை'),
    'New project':     E('Nuevo proyecto','新项目','नई परियोजना','مشروع جديد','Novo projeto','Nouveau projet','Neues Projekt','新規プロジェクト','Новый проект','Proyek baru','নতুন প্রকল্প','نیا منصوبہ','Yeni proje','Dự án mới','Nuovo progetto','새 프로젝트','புதிய திட்டம்'),
    'New session':     E('Nueva sesión','新会话','नया सत्र','جلسة جديدة','Nova sessão','Nouvelle session','Neue Sitzung','新しいセッション','Новая сессия','Sesi baru','নতুন সেশন','نیا سیشن','Yeni oturum','Phiên mới','Nuova sessione','새 세션','புதிய அமர்வு'),
    'Generate':        E('Generar','生成','उत्पन्न करें','إنشاء','Gerar','Générer','Generieren','生成','Создать','Hasilkan','তৈরি করুন','بنائیں','Oluştur','Tạo','Genera','생성','உருவாக்கு'),
    'Send':            E('Enviar','发送','भेजें','إرسال','Enviar','Envoyer','Senden','送信','Отправить','Kirim','পাঠান','بھیجیں','Gönder','Gửi','Invia','보내기','அனுப்பு'),
    'Send message':    E('Enviar mensaje','发送消息','संदेश भेजें','إرسال رسالة','Enviar mensagem','Envoyer le message','Nachricht senden','メッセージを送信','Отправить сообщение','Kirim pesan','বার্তা পাঠান','پیغام بھیجیں','Mesaj gönder','Gửi tin nhắn','Invia messaggio','메시지 보내기','செய்தி அனுப்பு'),
    'Run':             E('Ejecutar','运行','चलाएँ','تشغيل','Executar','Exécuter','Ausführen','実行','Запустить','Jalankan','চালান','چلائیں','Çalıştır','Chạy','Esegui','실행','இயக்கு'),
    'Write':           E('Escribir','写作','लिखें','كتابة','Escrever','Écrire','Schreiben','書く','Написать','Tulis','লিখুন','لکھیں','Yaz','Viết','Scrivi','작성','எழுது'),
    'Browse':          E('Explorar','浏览','ब्राउज़ करें','تصفح','Navegar','Parcourir','Durchsuchen','閲覧','Обзор','Jelajahi','ব্রাউজ করুন','براؤز کریں','Gözat','Duyệt','Sfoglia','둘러보기','உலாவு'),
    'Sell':            E('Vender','出售','बेचें','بيع','Vender','Vendre','Verkaufen','販売','Продать','Jual','বিক্রি','بیچیں','Sat','Bán','Vendi','판매','விற்பனை'),
    'Connect':         E('Conectar','连接','कनेक्ट करें','ربط','Conectar','Connecter','Verbinden','接続','Подключить','Hubungkan','সংযোগ করুন','جوڑیں','Bağlan','Kết nối','Connetti','연결','இணை'),
    'Manage':          E('Gestionar','管理','प्रबंधित करें','إدارة','Gerenciar','Gérer','Verwalten','管理','Управлять','Kelola','পরিচালনা','نظم کریں','Yönet','Quản lý','Gestisci','관리','நிர்வகி'),
    'Automate':        E('Automatizar','自动化','स्वचालित करें','أتمتة','Automatizar','Automatiser','Automatisieren','自動化','Автоматизировать','Otomatiskan','স্বয়ংক্রিয়','خودکار','Otomatikleştir','Tự động hóa','Automatizza','자동화','தானியக்கம்'),
    'Save changes':    E('Guardar cambios','保存更改','परिवर्तन सहेजें','حفظ التغييرات','Salvar alterações','Enregistrer','Änderungen speichern','変更を保存','Сохранить','Simpan perubahan','পরিবর্তন সংরক্ষণ','تبدیلیاں محفوظ کریں','Değişiklikleri kaydet','Lưu thay đổi','Salva modifiche','변경 사항 저장','மாற்றங்களைச் சேமி'),
    'Close':           E('Cerrar','关闭','बंद करें','إغلاق','Fechar','Fermer','Schließen','閉じる','Закрыть','Tutup','বন্ধ করুন','بند کریں','Kapat','Đóng','Chiudi','닫기','மூடு'),
    'More':            E('Más','更多','और','المزيد','Mais','Plus','Mehr','もっと','Ещё','Lainnya','আরও','مزید','Daha fazla','Thêm','Altro','더 보기','மேலும்'),
    'All':             E('Todos','全部','सभी','الكل','Todos','Tous','Alle','すべて','Все','Semua','সব','سب','Tümü','Tất cả','Tutti','전체','அனைத்தும்'),
    'Attach file':     E('Adjuntar archivo','附加文件','फ़ाइल संलग्न करें','إرفاق ملف','Anexar arquivo','Joindre un fichier','Datei anhängen','ファイルを添付','Прикрепить файл','Lampirkan file','ফাইল সংযুক্ত করুন','فائل منسلک کریں','Dosya ekle','Đính kèm tệp','Allega file','파일 첨부','கோப்பை இணை'),
    'Voice input':     E('Entrada de voz','语音输入','आवाज़ इनपुट','إدخال صوتي','Entrada de voz','Entrée vocale','Spracheingabe','音声入力','Голосовой ввод','Input suara','ভয়েস ইনপুট','صوتی ان پٹ','Sesli giriş','Nhập bằng giọng nói','Input vocale','음성 입력','குரல் உள்ளீடு'),
    'Web search':      E('Búsqueda web','网页搜索','वेब खोज','بحث الويب','Busca na web','Recherche web','Websuche','ウェブ検索','Веб-поиск','Pencarian web','ওয়েব অনুসন্ধান','ویب تلاش','Web araması','Tìm kiếm web','Ricerca web','웹 검색','வலைத் தேடல்'),

    // ---- Settings & account ----
    'Settings':        E('Ajustes','设置','सेटिंग्स','الإعدادات','Configurações','Paramètres','Einstellungen','設定','Настройки','Pengaturan','সেটিংস','ترتیبات','Ayarlar','Cài đặt','Impostazioni','설정','அமைப்புகள்'),
    'Account':         E('Cuenta','账户','खाता','الحساب','Conta','Compte','Konto','アカウント','Аккаунт','Akun','অ্যাকাউন্ট','اکاؤنٹ','Hesap','Tài khoản','Account','계정','கணக்கு'),
    'Privacy':         E('Privacidad','隐私','गोपनीयता','الخصوصية','Privacidade','Confidentialité','Datenschutz','プライバシー','Конфиденциальность','Privasi','গোপনীয়তা','رازداری','Gizlilik','Quyền riêng tư','Privacy','개인정보','தனியுரிமை'),
    'Security':        E('Seguridad','安全','सुरक्षा','الأمان','Segurança','Sécurité','Sicherheit','セキュリティ','Безопасность','Keamanan','নিরাপত্তা','سیکیورٹی','Güvenlik','Bảo mật','Sicurezza','보안','பாதுகாப்பு'),
    'Billing':         E('Facturación','账单','बिलिंग','الفوترة','Faturamento','Facturation','Abrechnung','請求','Оплата','Penagihan','বিলিং','بلنگ','Faturalandırma','Thanh toán','Fatturazione','결제','பில்லிங்'),
    'Usage':           E('Uso','用量','उपयोग','الاستخدام','Uso','Utilisation','Nutzung','使用状況','Использование','Penggunaan','ব্যবহার','استعمال','Kullanım','Sử dụng','Utilizzo','사용량','பயன்பாடு'),
    'Capabilities':    E('Capacidades','功能','क्षमताएँ','القدرات','Recursos','Capacités','Funktionen','機能','Возможности','Kemampuan','সক্ষমতা','صلاحیتیں','Yetenekler','Khả năng','Funzionalità','기능','திறன்கள்'),
    'Appearance':      E('Apariencia','外观','दिखावट','المظهر','Aparência','Apparence','Erscheinungsbild','外観','Внешний вид','Tampilan','চেহারা','ظاہری شکل','Görünüm','Giao diện','Aspetto','모양','தோற்றம்'),
    'Language':        E('Idioma','语言','भाषा','اللغة','Idioma','Langue','Sprache','言語','Язык','Bahasa','ভাষা','زبان','Dil','Ngôn ngữ','Lingua','언어','மொழி'),
    'Skills':          E('Habilidades','技能','कौशल','المهارات','Habilidades','Compétences','Fähigkeiten','スキル','Навыки','Keterampilan','দক্ষতা','مہارتیں','Beceriler','Kỹ năng','Competenze','스킬','திறன்கள்'),
    'Connectors':      E('Conectores','连接器','कनेक्टर','الموصلات','Conectores','Connecteurs','Konnektoren','コネクタ','Коннекторы','Konektor','কানেক্টর','کنیکٹرز','Bağlayıcılar','Trình kết nối','Connettori','커넥터','இணைப்பிகள்'),
    'Integrations':    E('Integraciones','集成','एकीकरण','التكاملات','Integrações','Intégrations','Integrationen','連携','Интеграции','Integrasi','ইন্টিগ্রেশন','انضمام','Entegrasyonlar','Tích hợp','Integrazioni','통합','ஒருங்கிணைப்புகள்'),
    'About':           E('Acerca de','关于','के बारे में','حول','Sobre','À propos','Über','概要','О программе','Tentang','সম্পর্কে','بارے میں','Hakkında','Giới thiệu','Informazioni','정보','பற்றி'),
    'Preferences':     E('Preferencias','偏好','प्राथमिकताएँ','التفضيلات','Preferências','Préférences','Einstellungen','設定','Настройки','Preferensi','পছন্দসমূহ','ترجیحات','Tercihler','Tùy chọn','Preferenze','환경설정','விருப்பங்கள்'),
    'Full name':       E('Nombre completo','全名','पूरा नाम','الاسم الكامل','Nome completo','Nom complet','Vollständiger Name','氏名','Полное имя','Nama lengkap','পুরো নাম','پورا نام','Ad soyad','Họ và tên','Nome completo','전체 이름','முழு பெயர்'),
    'Nickname':        E('Apodo','昵称','उपनाम','الكنية','Apelido','Surnom','Spitzname','ニックネーム','Псевдоним','Nama panggilan','ডাকনাম','عرفیت','Takma ad','Biệt danh','Soprannome','닉네임','புனைப்பெயர்'),
    'Password':        E('Contraseña','密码','पासवर्ड','كلمة المرور','Senha','Mot de passe','Passwort','パスワード','Пароль','Kata sandi','পাসওয়ার্ড','پاس ورڈ','Şifre','Mật khẩu','Password','비밀번호','கடவுச்சொல்'),
    'Sign out':        E('Cerrar sesión','退出','साइन आउट','تسجيل الخروج','Sair','Se déconnecter','Abmelden','サインアウト','Выйти','Keluar','সাইন আউট','سائن آؤٹ','Çıkış yap','Đăng xuất','Esci','로그아웃','வெளியேறு'),
    'Sign Out':        E('Cerrar sesión','退出','साइन आउट','تسجيل الخروج','Sair','Se déconnecter','Abmelden','サインアウト','Выйти','Keluar','সাইন আউট','سائن آؤٹ','Çıkış yap','Đăng xuất','Esci','로그아웃','வெளியேறு'),
    'Switch Account':  E('Cambiar cuenta','切换账户','खाता बदलें','تبديل الحساب','Trocar conta','Changer de compte','Konto wechseln','アカウント切替','Сменить аккаунт','Ganti akun','অ্যাকাউন্ট পরিবর্তন','اکاؤنٹ بدلیں','Hesap değiştir','Đổi tài khoản','Cambia account','계정 전환','கணக்கை மாற்று'),
    'Export data':     E('Exportar datos','导出数据','डेटा निर्यात करें','تصدير البيانات','Exportar dados','Exporter les données','Daten exportieren','データをエクスポート','Экспорт данных','Ekspor data','ডেটা রপ্তানি','ڈیٹا برآمد کریں','Verileri dışa aktar','Xuất dữ liệu','Esporta dati','데이터 내보내기','தரவை ஏற்றுமதி செய்'),
    'Delete everything':E('Eliminar todo','删除全部','सब कुछ हटाएँ','حذف كل شيء','Excluir tudo','Tout supprimer','Alles löschen','すべて削除','Удалить всё','Hapus semua','সবকিছু মুছুন','سب کچھ حذف کریں','Her şeyi sil','Xóa mọi thứ','Elimina tutto','모두 삭제','அனைத்தையும் நீக்கு'),

    // ---- Appearance options ----
    'Theme':           E('Tema','主题','थीम','السمة','Tema','Thème','Design','テーマ','Тема','Tema','থিম','تھیم','Tema','Chủ đề','Tema','테마','தீம்'),
    'Dark':            E('Oscuro','深色','गहरा','داكن','Escuro','Sombre','Dunkel','ダーク','Тёмная','Gelap','ডার্ক','گہرا','Koyu','Tối','Scuro','다크','இருள்'),
    'Dark Mode':       E('Modo oscuro','深色模式','डार्क मोड','الوضع الداكن','Modo escuro','Mode sombre','Dunkelmodus','ダークモード','Тёмный режим','Mode gelap','ডার্ক মোড','ڈارک موڈ','Koyu mod','Chế độ tối','Modalità scura','다크 모드','இருள் பயன்முறை'),
    'Font size':       E('Tamaño de fuente','字体大小','फ़ॉन्ट आकार','حجم الخط','Tamanho da fonte','Taille de police','Schriftgröße','文字サイズ','Размер шрифта','Ukuran font','ফন্ট আকার','فونٹ سائز','Yazı tipi boyutu','Cỡ chữ','Dimensione carattere','글꼴 크기','எழுத்துரு அளவு'),
    'Accent color':    E('Color de acento','强调色','एक्सेंट रंग','لون التمييز','Cor de destaque','Couleur d’accent','Akzentfarbe','アクセント色','Акцентный цвет','Warna aksen','অ্যাকসেন্ট রঙ','ایکسنٹ رنگ','Vurgu rengi','Màu nhấn','Colore accento','강조 색상','முனைப்பு நிறம்'),
    'Small':           E('Pequeño','小','छोटा','صغير','Pequeno','Petit','Klein','小','Маленький','Kecil','ছোট','چھوٹا','Küçük','Nhỏ','Piccolo','작게','சிறியது'),
    'Normal':          E('Normal','正常','सामान्य','عادي','Normal','Normal','Normal','標準','Обычный','Normal','স্বাভাবিক','عام','Normal','Bình thường','Normale','보통','இயல்பு'),
    'Large':           E('Grande','大','बड़ा','كبير','Grande','Grand','Groß','大','Большой','Besar','বড়','بڑا','Büyük','Lớn','Grande','크게','பெரியது'),
    'Language':        E('Idioma','语言','भाषा','اللغة','Idioma','Langue','Sprache','言語','Язык','Bahasa','ভাষা','زبان','Dil','Ngôn ngữ','Lingua','언어','மொழி'),

    // ---- Plans ----
    'Free':            E('Gratis','免费','मुफ़्त','مجاني','Grátis','Gratuit','Kostenlos','無料','Бесплатно','Gratis','ফ্রি','مفت','Ücretsiz','Miễn phí','Gratis','무료','இலவசம்'),
    'Pro':             E('Pro','专业版','प्रो','برو','Pro','Pro','Pro','プロ','Про','Pro','প্রো','پرو','Pro','Pro','Pro','프로','புரோ'),
    'Elite':           E('Élite','精英版','एलीट','النخبة','Elite','Élite','Elite','エリート','Элит','Elite','এলিট','ایلیٹ','Elit','Ưu tú','Elite','엘리트','எலைட்'),
    'Ultra':           E('Ultra','旗舰版','अल्ट्रा','ألترا','Ultra','Ultra','Ultra','ウルトラ','Ультра','Ultra','আল্ট্রা','الٹرا','Ultra','Ultra','Ultra','울트라','அல்ட்ரா'),
    'Custom':          E('Personalizado','定制','कस्टम','مخصص','Personalizado','Personnalisé','Individuell','カスタム','Свой','Kustom','কাস্টম','حسب ضرورت','Özel','Tùy chỉnh','Personalizzato','맞춤','தனிப்பயன்'),
    'Most Popular':    E('Más popular','最受欢迎','सबसे लोकप्रिय','الأكثر شيوعاً','Mais popular','Le plus populaire','Am beliebtesten','人気No.1','Популярный','Terpopuler','সবচেয়ে জনপ্রিয়','سب سے مقبول','En popüler','Phổ biến nhất','Più popolare','가장 인기','மிகவும் பிரபலம்'),
    'Most popular':    E('Más popular','最受欢迎','सबसे लोकप्रिय','الأكثر شيوعاً','Mais popular','Le plus populaire','Am beliebtesten','人気No.1','Популярный','Terpopuler','সবচেয়ে জনপ্রিয়','سب سے مقبول','En popüler','Phổ biến nhất','Più popolare','가장 인기','மிகவும் பிரபலம்'),
    'Best Value':      E('Mejor valor','超值之选','सर्वोत्तम मूल्य','أفضل قيمة','Melhor valor','Meilleur rapport','Bestes Angebot','お買い得','Выгодно','Nilai terbaik','সেরা মূল্য','بہترین قیمت','En iyi değer','Giá trị nhất','Miglior valore','최고 가치','சிறந்த மதிப்பு'),
    'Current plan':    E('Plan actual','当前套餐','वर्तमान योजना','الخطة الحالية','Plano atual','Forfait actuel','Aktueller Tarif','現在のプラン','Текущий тариф','Paket saat ini','বর্তমান প্ল্যান','موجودہ منصوبہ','Mevcut plan','Gói hiện tại','Piano attuale','현재 요금제','தற்போதைய திட்டம்'),
    'Subscription':    E('Suscripción','订阅','सदस्यता','الاشتراك','Assinatura','Abonnement','Abonnement','サブスク','Подписка','Langganan','সাবস্ক্রিপশন','سبسکرپشن','Abonelik','Đăng ký','Abbonamento','구독','சந்தா'),

    // ---- Status / misc ----
    'Current usage':   E('Uso actual','当前用量','वर्तमान उपयोग','الاستخدام الحالي','Uso atual','Utilisation actuelle','Aktuelle Nutzung','現在の使用量','Текущее использование','Penggunaan saat ini','বর্তমান ব্যবহার','موجودہ استعمال','Mevcut kullanım','Sử dụng hiện tại','Utilizzo attuale','현재 사용량','தற்போதைய பயன்பாடு'),
    'System status':   E('Estado del sistema','系统状态','सिस्टम स्थिति','حالة النظام','Status do sistema','État du système','Systemstatus','システム状態','Статус системы','Status sistem','সিস্টেম স্ট্যাটাস','سسٹم اسٹیٹس','Sistem durumu','Trạng thái hệ thống','Stato del sistema','시스템 상태','கணினி நிலை'),
    'Keyboard shortcuts':E('Atajos de teclado','键盘快捷键','कीबोर्ड शॉर्टकट','اختصارات لوحة المفاتيح','Atalhos de teclado','Raccourcis clavier','Tastenkürzel','キーボードショートカット','Горячие клавиши','Pintasan keyboard','কীবোর্ড শর্টকাট','کی بورڈ شارٹ کٹس','Klavye kısayolları','Phím tắt','Scorciatoie da tastiera','키보드 단축키','விசைப்பலகை குறுக்குவழிகள்'),
    'Keyboard Shortcuts':E('Atajos de teclado','键盘快捷键','कीबोर्ड शॉर्टकट','اختصارات لوحة المفاتيح','Atalhos de teclado','Raccourcis clavier','Tastenkürzel','キーボードショートカット','Горячие клавиши','Pintasan keyboard','কীবোর্ড শর্টকাট','کی بورڈ شارٹ کٹس','Klavye kısayolları','Phím tắt','Scorciatoie da tastiera','키보드 단축키','விசைப்பலகை குறுக்குவழிகள்'),
    'New line':        E('Nueva línea','换行','नई पंक्ति','سطر جديد','Nova linha','Nouvelle ligne','Neue Zeile','改行','Новая строка','Baris baru','নতুন লাইন','نئی لائن','Yeni satır','Dòng mới','Nuova riga','새 줄','புதிய வரி'),
    'Toggle sidebar':  E('Alternar barra lateral','切换侧栏','साइडबार टॉगल करें','تبديل الشريط الجانبي','Alternar barra lateral','Basculer la barre','Seitenleiste umschalten','サイドバー切替','Боковая панель','Alihkan bilah sisi','সাইডবার টগল','سائیڈبار ٹوگل','Kenar çubuğunu aç/kapat','Bật/tắt thanh bên','Mostra/nascondi barra','사이드바 전환','பக்கப்பட்டியை மாற்று'),
    "What's New":      E('Novedades','新功能','नया क्या है','ما الجديد','Novidades','Nouveautés','Neuigkeiten','新着情報','Что нового','Yang baru','নতুন কী','نیا کیا ہے','Yenilikler','Có gì mới','Novità','새로운 기능','புதியது என்ன'),
    'Page not found':  E('Página no encontrada','页面未找到','पृष्ठ नहीं मिला','الصفحة غير موجودة','Página não encontrada','Page introuvable','Seite nicht gefunden','ページが見つかりません','Страница не найдена','Halaman tidak ditemukan','পৃষ্ঠা পাওয়া যায়নি','صفحہ نہیں ملا','Sayfa bulunamadı','Không tìm thấy trang','Pagina non trovata','페이지를 찾을 수 없음','பக்கம் கிடைக்கவில்லை'),
    'Help Center':     E('Centro de ayuda','帮助中心','सहायता केंद्र','مركز المساعدة','Central de ajuda','Centre d’aide','Hilfecenter','ヘルプセンター','Центр помощи','Pusat bantuan','সহায়তা কেন্দ্র','مدد مرکز','Yardım merkezi','Trung tâm trợ giúp','Centro assistenza','도움말 센터','உதவி மையம்'),
    'Contact Support': E('Contactar soporte','联系支持','सहायता से संपर्क करें','اتصل بالدعم','Contatar suporte','Contacter le support','Support kontaktieren','サポートに連絡','Связаться с поддержкой','Hubungi dukungan','সহায়তায় যোগাযোগ','سپورٹ سے رابطہ','Desteğe başvur','Liên hệ hỗ trợ','Contatta assistenza','지원팀 문의','ஆதரவைத் தொடர்பு கொள்ளுங்கள்'),
    'Terms of Service':E('Términos de servicio','服务条款','सेवा की शर्तें','شروط الخدمة','Termos de serviço','Conditions d’utilisation','Nutzungsbedingungen','利用規約','Условия использования','Ketentuan layanan','পরিষেবার শর্তাবলী','سروس کی شرائط','Hizmet şartları','Điều khoản dịch vụ','Termini di servizio','서비스 약관','சேவை விதிமுறைகள்'),
    'Privacy Policy':  E('Política de privacidad','隐私政策','गोपनीयता नीति','سياسة الخصوصية','Política de privacidade','Politique de confidentialité','Datenschutzrichtlinie','プライバシーポリシー','Политика конфиденциальности','Kebijakan privasi','গোপনীয়তা নীতি','رازداری کی پالیسی','Gizlilik politikası','Chính sách bảo mật','Informativa privacy','개인정보 처리방침','தனியுரிமைக் கொள்கை'),
    'Research':        E('Investigar','研究','अनुसंधान','بحث','Pesquisa','Recherche','Recherche','リサーチ','Исследование','Riset','গবেষণা','تحقیق','Araştırma','Nghiên cứu','Ricerca','리서치','ஆராய்ச்சி'),
    'Code':            E('Código','代码','कोड','الكود','Código','Code','Code','コード','Код','Kode','কোড','کوڈ','Kod','Mã','Codice','코드','குறியீடு'),
    'Files':           E('Archivos','文件','फ़ाइलें','الملفات','Arquivos','Fichiers','Dateien','ファイル','Файлы','File','ফাইল','فائلیں','Dosyalar','Tệp','File','파일','கோப்புகள்'),
    'Style':           E('Estilo','风格','शैली','النمط','Estilo','Style','Stil','スタイル','Стиль','Gaya','স্টাইল','انداز','Stil','Phong cách','Stile','스타일','பாணி'),
    'Duration':        E('Duración','时长','अवधि','المدة','Duração','Durée','Dauer','長さ','Длительность','Durasi','সময়কাল','دورانیہ','Süre','Thời lượng','Durata','길이','கால அளவு'),
    'Output':          E('Salida','输出','आउटपुट','الناتج','Saída','Sortie','Ausgabe','出力','Результат','Keluaran','আউটপুট','آؤٹ پٹ','Çıktı','Đầu ra','Output','출력','வெளியீடு'),
    'Preview':         E('Vista previa','预览','पूर्वावलोकन','معاينة','Prévia','Aperçu','Vorschau','プレビュー','Просмотр','Pratinjau','প্রিভিউ','پیش نظارہ','Önizleme','Xem trước','Anteprima','미리보기','முன்னோட்டம்'),
    'Earnings':        E('Ganancias','收入','कमाई','الأرباح','Ganhos','Revenus','Einnahmen','収益','Доход','Penghasilan','আয়','کمائی','Kazançlar','Thu nhập','Guadagni','수익','வருவாய்'),
    'Finance':         E('Finanzas','财务','वित्त','المالية','Finanças','Finances','Finanzen','財務','Финансы','Keuangan','অর্থ','مالیات','Finans','Tài chính','Finanza','재무','நிதி'),
    'Dashboard':       E('Panel','仪表板','डैशबोर्ड','لوحة القيادة','Painel','Tableau de bord','Übersicht','ダッシュボード','Панель','Dasbor','ড্যাশবোর্ড','ڈیش بورڈ','Kontrol paneli','Bảng điều khiển','Dashboard','대시보드','டாஷ்போர்டு'),
    'Messages':        E('Mensajes','消息','संदेश','الرسائل','Mensagens','Messages','Nachrichten','メッセージ','Сообщения','Pesan','বার্তা','پیغامات','Mesajlar','Tin nhắn','Messaggi','메시지','செய்திகள்'),
    'Sessions':        E('Sesiones','会话','सत्र','الجلسات','Sessões','Sessions','Sitzungen','セッション','Сессии','Sesi','সেশন','سیشنز','Oturumlar','Phiên','Sessioni','세션','அமர்வுகள்'),
    'Active':          E('Activo','活跃','सक्रिय','نشط','Ativo','Actif','Aktiv','アクティブ','Активно','Aktif','সক্রিয়','فعال','Aktif','Đang hoạt động','Attivo','활성','செயலில்'),
    'Incoming':        E('Entrante','传入','आवक','وارد','Recebido','Entrant','Eingehend','受信','Входящие','Masuk','আগত','آنے والا','Gelen','Đến','In arrivo','수신','உள்வரும்'),
    'Sent':            E('Enviado','已发送','भेजा गया','مرسل','Enviado','Envoyé','Gesendet','送信済み','Отправлено','Terkirim','পাঠানো হয়েছে','بھیجا گیا','Gönderildi','Đã gửi','Inviato','전송됨','அனுப்பப்பட்டது'),
    'Newest':          E('Más reciente','最新','नवीनतम','الأحدث','Mais recente','Le plus récent','Neueste','最新','Новейшие','Terbaru','নতুনতম','تازہ ترین','En yeni','Mới nhất','Più recente','최신','புதியது'),
    'Best rated':      E('Mejor valorado','评分最高','सर्वोत्तम रेटेड','الأعلى تقييماً','Melhor avaliado','Les mieux notés','Bestbewertet','高評価','Лучшие','Rating tertinggi','সেরা রেটেড','بہترین درجہ','En yüksek puanlı','Đánh giá cao nhất','Più votati','평점 높은순','சிறந்த மதிப்பீடு'),
    'Top sellers':     E('Más vendidos','热销','शीर्ष विक्रेता','الأكثر مبيعاً','Mais vendidos','Meilleures ventes','Bestseller','売れ筋','Хиты продаж','Terlaris','সেরা বিক্রেতা','ٹاپ سیلرز','En çok satanlar','Bán chạy nhất','Più venduti','베스트셀러','அதிக விற்பனை'),
    'My purchases':    E('Mis compras','我的购买','मेरी खरीदारी','مشترياتي','Minhas compras','Mes achats','Meine Käufe','購入履歴','Мои покупки','Pembelian saya','আমার কেনাকাটা','میری خریداری','Satın aldıklarım','Đơn mua của tôi','I miei acquisti','내 구매','எனது கொள்முதல்கள்'),
    'General':         E('General','通用','सामान्य','عام','Geral','Général','Allgemein','一般','Общие','Umum','সাধারণ','عام','Genel','Chung','Generale','일반','பொது'),
    'Personal':        E('Personal','个人','व्यक्तिगत','شخصي','Pessoal','Personnel','Persönlich','個人','Личное','Pribadi','ব্যক্তিগত','ذاتی','Kişisel','Cá nhân','Personale','개인','தனிப்பட்ட'),
    'Business':        E('Empresa','商业','व्यवसाय','الأعمال','Negócios','Entreprise','Unternehmen','ビジネス','Бизнес','Bisnis','ব্যবসা','کاروبار','İşletme','Doanh nghiệp','Azienda','비즈니스','வணிகம்'),
    'Marketing':       E('Marketing','营销','मार्केटिंग','التسويق','Marketing','Marketing','Marketing','マーケティング','Маркетинг','Pemasaran','মার্কেটিং','مارکیٹنگ','Pazarlama','Tiếp thị','Marketing','마케팅','சந்தைப்படுத்தல்'),
    'Sales':           E('Ventas','销售','बिक्री','المبيعات','Vendas','Ventes','Vertrieb','営業','Продажи','Penjualan','বিক্রয়','فروخت','Satış','Bán hàng','Vendite','영업','விற்பனை'),
    'Education':       E('Educación','教育','शिक्षा','التعليم','Educação','Éducation','Bildung','教育','Образование','Pendidikan','শিক্ষা','تعلیم','Eğitim','Giáo dục','Istruzione','교육','கல்வி'),
    'Productivity':    E('Productividad','生产力','उत्पादकता','الإنتاجية','Produtividade','Productivité','Produktivität','生産性','Продуктивность','Produktivitas','উৎপাদনশীলতা','پیداواری صلاحیت','Üretkenlik','Năng suất','Produttività','생산성','உற்பத்தித்திறன்'),
    'Developer':       E('Desarrollador','开发者','डेवलपर','المطور','Desenvolvedor','Développeur','Entwickler','開発者','Разработчик','Pengembang','ডেভেলপার','ڈیولپر','Geliştirici','Nhà phát triển','Sviluppatore','개발자','டெவலப்பர்'),
    'Student':         E('Estudiante','学生','छात्र','طالب','Estudante','Étudiant','Student','学生','Студент','Pelajar','ছাত্র','طالب علم','Öğrenci','Sinh viên','Studente','학생','மாணவர்'),
    'Work':            E('Trabajo','工作','काम','العمل','Trabalho','Travail','Arbeit','仕事','Работа','Kerja','কাজ','کام','İş','Công việc','Lavoro','업무','வேலை'),
    'Auto':            E('Auto','自动','ऑटो','تلقائي','Auto','Auto','Auto','自動','Авто','Otomatis','অটো','آٹو','Otomatik','Tự động','Auto','자동','தானி'),
    'Auto-detect':     E('Autodetectar','自动检测','स्वतः पहचान','كشف تلقائي','Detectar automaticamente','Détection auto','Automatisch erkennen','自動検出','Автоопределение','Deteksi otomatis','স্বয়ংক্রিয় সনাক্তকরণ','خودکار شناخت','Otomatik algıla','Tự động phát hiện','Rilevamento automatico','자동 감지','தானாக கண்டறி'),
    'Response language':E('Idioma de respuesta','回复语言','उत्तर भाषा','لغة الرد','Idioma da resposta','Langue de réponse','Antwortsprache','応答言語','Язык ответа','Bahasa respons','উত্তরের ভাষা','جواب کی زبان','Yanıt dili','Ngôn ngữ trả lời','Lingua di risposta','응답 언어','பதில் மொழி'),
    'Reduce animation':E('Reducir animación','减少动画','एनिमेशन कम करें','تقليل الحركة','Reduzir animação','Réduire l’animation','Animation reduzieren','アニメーション低減','Меньше анимации','Kurangi animasi','অ্যানিমেশন কমান','اینیمیشن کم کریں','Animasyonu azalt','Giảm hiệu ứng','Riduci animazioni','애니메이션 줄이기','அசைவூட்டத்தைக் குறை'),
    'Motion':          E('Movimiento','动效','मोशन','الحركة','Movimento','Mouvement','Bewegung','モーション','Движение','Gerak','মোশন','حرکت','Hareket','Chuyển động','Movimento','모션','அசைவு'),
    'Default':         E('Predeterminado','默认','डिफ़ॉल्ट','افتراضي','Padrão','Par défaut','Standard','デフォルト','По умолчанию','Default','ডিফল্ট','ڈیفالٹ','Varsayılan','Mặc định','Predefinito','기본값','இயல்புநிலை'),
    'Controls':        E('Controles','控制','नियंत्रण','التحكم','Controles','Contrôles','Steuerung','コントロール','Управление','Kontrol','নিয়ন্ত্রণ','کنٹرولز','Kontroller','Điều khiển','Controlli','컨트롤','கட்டுப்பாடுகள்'),
    'Aspect':          E('Aspecto','比例','पहलू','النسبة','Proporção','Format','Seitenverhältnis','アスペクト','Соотношение','Aspek','অনুপাত','تناسب','En boy oranı','Tỷ lệ','Proporzioni','비율','விகிதம்'),
    'Ratio':           E('Proporción','比例','अनुपात','النسبة','Proporção','Ratio','Verhältnis','比率','Соотношение','Rasio','অনুপাত','تناسب','Oran','Tỷ lệ','Rapporto','비율','விகிதம்'),
    'Mood':            E('Ambiente','氛围','मूड','المزاج','Clima','Ambiance','Stimmung','ムード','Настроение','Suasana','মেজাজ','موڈ','Ruh hali','Tâm trạng','Atmosfera','분위기','மனநிலை'),
    'Presets':         E('Preajustes','预设','प्रीसेट','الإعدادات المسبقة','Predefinições','Préréglages','Voreinstellungen','プリセット','Пресеты','Preset','প্রিসেট','پیش سیٹ','Ön ayarlar','Cài đặt sẵn','Preset','프리셋','முன்னமைவுகள்'),
    'Your data':       E('Tus datos','你的数据','आपका डेटा','بياناتك','Seus dados','Vos données','Ihre Daten','あなたのデータ','Ваши данные','Data Anda','আপনার ডেটা','آپ کا ڈیٹا','Verileriniz','Dữ liệu của bạn','I tuoi dati','내 데이터','உங்கள் தரவு'),
    'Your name':       E('Tu nombre','你的名字','आपका नाम','اسمك','Seu nome','Votre nom','Ihr Name','あなたの名前','Ваше имя','Nama Anda','আপনার নাম','آپ کا نام','Adınız','Tên của bạn','Il tuo nome','이름','உங்கள் பெயர்'),
    'Your impact':     E('Tu impacto','你的成果','आपका प्रभाव','تأثيرك','Seu impacto','Votre impact','Ihre Wirkung','あなたの成果','Ваш вклад','Dampak Anda','আপনার প্রভাব','آپ کا اثر','Etkiniz','Tác động của bạn','Il tuo impatto','내 영향','உங்கள் தாக்கம்'),
    'Your skills':     E('Tus habilidades','你的技能','आपके कौशल','مهاراتك','Suas habilidades','Vos compétences','Ihre Fähigkeiten','あなたのスキル','Ваши навыки','Keterampilan Anda','আপনার দক্ষতা','آپ کی مہارتیں','Becerileriniz','Kỹ năng của bạn','Le tue competenze','내 스킬','உங்கள் திறன்கள்'),
    'Your messages':   E('Tus mensajes','你的消息','आपके संदेश','رسائلك','Suas mensagens','Vos messages','Ihre Nachrichten','あなたのメッセージ','Ваши сообщения','Pesan Anda','আপনার বার্তা','آپ کے پیغامات','Mesajlarınız','Tin nhắn của bạn','I tuoi messaggi','내 메시지','உங்கள் செய்திகள்'),
    'Recurring work':  E('Trabajo recurrente','周期性工作','आवर्ती कार्य','عمل متكرر','Trabalho recorrente','Travail récurrent','Wiederkehrende Arbeit','定期作業','Повторяющаяся работа','Kerja berulang','পুনরাবৃত্ত কাজ','بار بار کام','Yinelenen iş','Công việc định kỳ','Lavoro ricorrente','반복 작업','தொடர் வேலை'),
    'Scheduled work':  E('Trabajo programado','计划工作','निर्धारित कार्य','عمل مجدول','Trabalho agendado','Travail planifié','Geplante Arbeit','予約作業','Запланированная работа','Kerja terjadwal','নির্ধারিত কাজ','شیڈول شدہ کام','Zamanlanmış iş','Công việc đã lên lịch','Lavoro pianificato','예약 작업','திட்டமிட்ட வேலை'),
    'Add Memory':      E('Añadir memoria','添加记忆','स्मृति जोड़ें','إضافة ذاكرة','Adicionar memória','Ajouter une mémoire','Speicher hinzufügen','メモリを追加','Добавить память','Tambah memori','স্মৃতি যোগ করুন','یادداشت شامل کریں','Bellek ekle','Thêm bộ nhớ','Aggiungi memoria','메모리 추가','நினைவகம் சேர்'),
    'Open memory':     E('Abrir memoria','打开记忆','स्मृति खोलें','فتح الذاكرة','Abrir memória','Ouvrir la mémoire','Speicher öffnen','メモリを開く','Открыть память','Buka memori','স্মৃতি খুলুন','یادداشت کھولیں','Belleği aç','Mở bộ nhớ','Apri memoria','메모리 열기','நினைவகத்தைத் திற'),
    'Clear chats':     E('Borrar chats','清除对话','चैट साफ़ करें','مسح المحادثات','Limpar conversas','Effacer les chats','Chats löschen','チャットを消去','Очистить чаты','Hapus obrolan','চ্যাট সাফ করুন','چیٹس صاف کریں','Sohbetleri temizle','Xóa trò chuyện','Cancella chat','채팅 지우기','அரட்டைகளை அழி'),
    'Remove photo':    E('Quitar foto','移除照片','फ़ोटो हटाएँ','إزالة الصورة','Remover foto','Supprimer la photo','Foto entfernen','写真を削除','Удалить фото','Hapus foto','ছবি সরান','تصویر ہٹائیں','Fotoğrafı kaldır','Xóa ảnh','Rimuovi foto','사진 제거','புகைப்படத்தை அகற்று'),
    'Try it →':        E('Pruébalo →','试试 →','आज़माएँ →','جرّبه →','Experimente →','Essayez →','Ausprobieren →','試す →','Попробовать →','Coba →','চেষ্টা করুন →','آزمائیں →','Deneyin →','Thử ngay →','Provalo →','사용해보기 →','முயற்சி →'),
    'Get started free':E('Comienza gratis','免费开始','मुफ़्त शुरू करें','ابدأ مجاناً','Comece grátis','Commencer gratuitement','Kostenlos starten','無料で始める','Начать бесплатно','Mulai gratis','ফ্রি শুরু করুন','مفت شروع کریں','Ücretsiz başla','Bắt đầu miễn phí','Inizia gratis','무료로 시작','இலவசமாகத் தொடங்கு'),
  };

  try{
    if(typeof window!=='undefined'){
      window.__AMV_I18N_DICT__ = D;
    }
  }catch(e){}
  if(typeof module!=='undefined' && module.exports){ module.exports = D; }
})();
