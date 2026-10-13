# 网页通过 window.ChisaBotAndroid 调用的方法
-keepclassmembers class cn.ayase.chisabot.MainActivity$Bridge {
    @android.webkit.JavascriptInterface <methods>;
}

# 本机登录页（assets/login/login.html）通过 window.ChisaLogin 调用的方法
-keepclassmembers class cn.ayase.chisabot.MainActivity$LoginBridge {
    @android.webkit.JavascriptInterface <methods>;
}

# 扫码绑定（zxing-android-embedded）：库自带 consumer 规则不全，保留扫码界面与解码器。
-keep class com.journeyapps.barcodescanner.** { *; }
-keep class com.google.zxing.** { *; }
-dontwarn com.google.zxing.**
