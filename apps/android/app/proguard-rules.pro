# kotlinx.serialization
-keepattributes *Annotation*, InnerClasses, Signature, EnclosingMethod
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.luminarasuite.app.**$$serializer { *; }
-keepclassmembers class com.luminarasuite.app.** {
    *** Companion;
}
-keepclasseswithmembers class com.luminarasuite.app.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Retrofit 3 & Coroutines
-keepattributes RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations, MethodParameters
-keepclassmembers,allowshrinking,allowobfuscation interface * {
    @retrofit2.http.* <methods>;
}
-dontwarn retrofit2.**
-dontwarn javax.annotation.**
-keep,allowobfuscation,allowshrinking interface retrofit2.Call
-keep,allowobfuscation,allowshrinking class retrofit2.Response
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation

# OkHttp 5 / Okio
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# Room 3
-keep class * extends androidx.room3.RoomDatabase {
    <init>();
}
-dontwarn androidx.room3.paging.**

# BuildConfig & Entry points
-keep class com.luminarasuite.app.BuildConfig { *; }
-keep class com.luminarasuite.app.MainActivity { *; }
