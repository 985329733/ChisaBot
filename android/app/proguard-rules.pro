# 网页通过 window.ChisaBotAndroid 调用的方法
-keepclassmembers class cn.ayase.chisabot.MainActivity$Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
