# 扫码绑定（zxing-android-embedded）：库自带 consumer 规则不全，保留扫码界面与解码器。
-keep class com.journeyapps.barcodescanner.** { *; }
-keep class com.google.zxing.** { *; }
-dontwarn com.google.zxing.**
# OkHttp / kotlinx.serialization（只用 JsonElement，不用反射序列化）
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
