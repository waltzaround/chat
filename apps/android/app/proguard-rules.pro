# kotlinx.serialization keeps its generated serializers.
-keepattributes *Annotation*, InnerClasses
-keepclassmembers @kotlinx.serialization.Serializable class chat.beacon.android.** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
# Tink (EncryptedSharedPreferences) references compile-only annotations.
-dontwarn com.google.errorprone.annotations.CanIgnoreReturnValue
-dontwarn com.google.errorprone.annotations.CheckReturnValue
-dontwarn com.google.errorprone.annotations.Immutable
-dontwarn com.google.errorprone.annotations.RestrictedApi
