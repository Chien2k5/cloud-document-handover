package vn.edu.uet.handover.auth;

import com.fasterxml.jackson.annotation.JsonAutoDetect;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.nio.charset.StandardCharsets;
import vn.edu.uet.handover.common.StrictStringDeserializer;

/** Input only. Validation inspects normalized views without changing submitted values. */
@JsonAutoDetect(fieldVisibility=JsonAutoDetect.Visibility.NONE,
        getterVisibility=JsonAutoDetect.Visibility.NONE,
        isGetterVisibility=JsonAutoDetect.Visibility.NONE,
        setterVisibility=JsonAutoDetect.Visibility.NONE)
public final class RegistrationRequest {
    @JsonProperty @JsonSetter(nulls=Nulls.FAIL)
    @JsonDeserialize(using=StrictStringDeserializer.class)
    @NotBlank(message="Display name is required")
    @Pattern(regexp="(?Us).*\\S.*", message="Display name is required")
    private String displayName;

    @JsonProperty @JsonSetter(nulls=Nulls.FAIL)
    @JsonDeserialize(using=StrictStringDeserializer.class)
    @NotBlank(message="Email is required")
    @Size(max=254, message="Email must contain at most 254 characters")
    private String email;

    @JsonProperty(access=JsonProperty.Access.WRITE_ONLY) @JsonSetter(nulls=Nulls.FAIL)
    @JsonDeserialize(using=StrictStringDeserializer.class)
    @NotBlank(message="Password is required")
    @Pattern(regexp="(?Us).*\\S.*", message="Password is required")
    private String password;

    @JsonProperty(access=JsonProperty.Access.WRITE_ONLY) @JsonSetter(nulls=Nulls.FAIL)
    @JsonDeserialize(using=StrictStringDeserializer.class)
    @NotBlank(message="Password confirmation is required")
    @Pattern(regexp="(?Us).*\\S.*", message="Password confirmation is required")
    private String confirmPassword;

    public String displayName() { return displayName; }
    public String email() { return email; }
    public String password() { return password; }
    public String confirmPassword() { return confirmPassword; }

    // Bean Validation getters are deliberately excluded from the four-field JSON shape.
    @AssertTrue(message="Display name must contain at most 100 characters after stripping")
    public boolean isDisplayNameLengthValid() {
        if (displayName == null) return true;
        String stripped = displayName.strip();
        return stripped.codePointCount(0, stripped.length()) <= 100;
    }

    @Email(message="Email must have a valid format")
    public String getEmailForValidation() {
        return email == null ? null : email.trim();
    }

    @AssertTrue(message="Password must contain at least 8 characters")
    public boolean isPasswordCharacterLengthValid() {
        return password == null || password.codePointCount(0, password.length()) >= 8;
    }

    @AssertTrue(message="Password must contain at most 72 UTF-8 bytes")
    public boolean isPasswordUtf8LengthValid() {
        return password == null || password.getBytes(StandardCharsets.UTF_8).length <= 72;
    }

    @AssertTrue(message="Password confirmation must match password exactly")
    public boolean isPasswordConfirmationValid() {
        return password == null || confirmPassword == null || password.equals(confirmPassword);
    }

    @Override public String toString() { return "RegistrationRequest[redacted]"; }
}
