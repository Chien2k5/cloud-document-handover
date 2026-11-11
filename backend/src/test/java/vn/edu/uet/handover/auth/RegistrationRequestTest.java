package vn.edu.uet.handover.auth;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.exc.MismatchedInputException;
import com.fasterxml.jackson.databind.exc.UnrecognizedPropertyException;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import java.util.Set;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.json.JsonTest;

/** Actual Spring Jackson configuration; no database, controller or security changes. */
@JsonTest
class RegistrationRequestTest {
    @Autowired ObjectMapper json;
    static ValidatorFactory factory;
    static Validator validator;

    @BeforeAll static void startValidation() {
        factory = Validation.buildDefaultValidatorFactory();
        validator = factory.getValidator();
    }
    @AfterAll static void closeValidation() { factory.close(); }

    ObjectNode validBody() {
        return json.createObjectNode().put("displayName", "Nguyen Van A")
                .put("email", "person@example.test").put("password", "Fixture123")
                .put("confirmPassword", "Fixture123");
    }
    RegistrationRequest read(ObjectNode body) throws Exception {
        return json.readValue(json.writeValueAsBytes(body), RegistrationRequest.class);
    }
    Set<ConstraintViolation<RegistrationRequest>> violations(ObjectNode body) throws Exception {
        return validator.validate(read(body));
    }
    void accepted(ObjectNode body) throws Exception {
        // Only report paths on assertion failure, never invalid password values.
        assertThat(violations(body)).extracting(v -> v.getPropertyPath().toString()).isEmpty();
    }
    void rejected(ObjectNode body) throws Exception {
        assertThat(violations(body).size()).isGreaterThan(0);
    }
    ObjectNode withPassword(String password) {
        return validBody().put("password", password).put("confirmPassword", password);
    }

    @Test void acceptsExactlyTheFourRequiredFieldsAndPreservesTheirValues() throws Exception {
        ObjectNode body = validBody();
        RegistrationRequest request = read(body);
        assertThat(request.displayName()).isEqualTo("Nguyen Van A");
        assertThat(request.email()).isEqualTo("person@example.test");
        assertThat(request.password()).isEqualTo("Fixture123");
        assertThat(request.confirmPassword()).isEqualTo("Fixture123");
        accepted(body);
    }

    @ParameterizedTest(name="{index}")
    @ValueSource(strings={"", " ", "\t\r\n", "\u2003\u2003", "\u00a0", "\u202f", "\u2009"})
    void rejectsBlankDisplayName(String value) throws Exception {
        rejected(validBody().put("displayName", value));
    }

    @ParameterizedTest(name="{index}")
    @ValueSource(ints={1, 99, 100})
    void acceptsDisplayNameAtValidLengthBoundaries(int length) throws Exception {
        accepted(validBody().put("displayName", "a".repeat(length)));
    }

    @Test void measuresDisplayNameAfterStrippingWithoutChangingInput() throws Exception {
        String name = "\t \u2003" + "a".repeat(100) + "\u2003 \n";
        RegistrationRequest request = read(validBody().put("displayName", name));
        assertThat(validator.validate(request).size()).isZero();
        assertThat(request.displayName()).isEqualTo(name);
    }

    @Test void countsSupplementaryDisplayNameCharactersWithoutSplittingSurrogatePairs() throws Exception {
        accepted(validBody().put("displayName", "😀".repeat(100)));
        rejected(validBody().put("displayName", "😀".repeat(101)));
    }

    @ParameterizedTest(name="{index}")
    @ValueSource(ints={101, 102})
    void rejectsDisplayNameBeyondTheTrimmedLimit(int length) throws Exception {
        rejected(validBody().put("displayName", "  " + "a".repeat(length) + "  "));
    }

    @ParameterizedTest(name="{index}")
    @ValueSource(strings={"", " ", "\t\n", "not-email", "person@", "@example.test",
            "two@@example.test", "person name@example.test", "person@example..test"})
    void rejectsInvalidEmail(String email) throws Exception {
        rejected(validBody().put("email", email));
    }

    static String longEmail(int length) {
        // 64-character local part and valid domain labels, never an accidental format failure.
        return "a".repeat(64) + "@" + "b".repeat(63) + "." + "c".repeat(63)
                + "." + "d".repeat(length - 193);
    }
    @ParameterizedTest(name="{index}")
    @ValueSource(ints={253, 254})
    void acceptsEmailAtTheSizeBoundary(int length) throws Exception {
        String email = longEmail(length);
        assertThat(email.length()).isEqualTo(length);
        accepted(validBody().put("email", email));
    }

    @Test void rejectsEmailOver254CharactersEvenWhenItsFormatIsValid() throws Exception {
        String email = longEmail(255);
        assertThat(email.length()).isEqualTo(255);
        assertThat(violations(validBody().put("email", email)))
                .extracting(v -> v.getPropertyPath().toString()).contains("email");
    }

    @Test void checksTrimmedEmailFormatButLeavesNormalizationToBusinessLogic() throws Exception {
        String email = "  Person@Example.TEST  ";
        RegistrationRequest request = read(validBody().put("email", email));
        assertThat(validator.validate(request).size()).isZero();
        assertThat(request.email()).isEqualTo(email);
        rejected(validBody().put("email", " " + longEmail(254) + " "));
    }

    @ParameterizedTest(name="{index}")
    @ValueSource(strings={"", "1234567", "        ", "\t\r\n      ", "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003",
            "\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0",
            "\u202f\u202f\u202f\u202f\u202f\u202f\u202f\u202f"})
    void rejectsShortOrBlankPassword(String password) throws Exception {
        rejected(withPassword(password));
    }

    @Test void requiresEightPasswordCharactersRatherThanEightUtf16Units() throws Exception {
        rejected(withPassword("😀".repeat(4)));
        rejected(withPassword("😀".repeat(7)));
    }

    static Stream<String> validPasswords() {
        return Stream.of("12345678", "😀".repeat(8), "a".repeat(71), "a".repeat(72), "á".repeat(36),
                "€".repeat(24), "😀".repeat(18), "e\u0301".repeat(24), "  AbCd1234  ");
    }
    @ParameterizedTest(name="{index}")
    @MethodSource("validPasswords")
    void acceptsAsciiAndMultibytePasswordBoundariesWithoutNormalization(String password) throws Exception {
        RegistrationRequest request = read(withPassword(password));
        assertThat(validator.validate(request).size()).isZero();
        assertThat(request.password()).isEqualTo(password);
        assertThat(request.confirmPassword()).isEqualTo(password);
    }

    static Stream<String> overlongPasswords() {
        return Stream.of("a".repeat(73), "á".repeat(36) + "a", "€".repeat(24) + "a",
                "😀".repeat(18) + "a", "e\u0301".repeat(24) + "a");
    }
    @ParameterizedTest(name="{index}")
    @MethodSource("overlongPasswords")
    void rejectsOver72Utf8BytesEvenBelow72JavaCharacters(String password) throws Exception {
        assertThat(violations(withPassword(password)))
                .extracting(v -> v.getPropertyPath().toString()).contains("passwordUtf8LengthValid");
    }

    @ParameterizedTest(name="{index}")
    @ValueSource(strings={"Other123", "fixture123", " Fixture123", "Fixture123 ", "", " "})
    void rejectsPasswordConfirmationThatIsNotAnExactMatch(String confirmation) throws Exception {
        rejected(validBody().put("confirmPassword", confirmation));
    }

    @Test void doesNotNormalizeUnicodePasswordConfirmation() throws Exception {
        rejected(validBody().put("password", "é".repeat(8)).put("confirmPassword", "e\u0301".repeat(8)));
    }

    @ParameterizedTest(name="{index}")
    @ValueSource(strings={"displayName", "email", "password", "confirmPassword"})
    void rejectsEachMissingField(String field) throws Exception {
        ObjectNode body = validBody(); body.remove(field); rejected(body);
    }

    @ParameterizedTest(name="{index}")
    @ValueSource(strings={"displayName", "email", "password", "confirmPassword"})
    void rejectsEachExplicitNull(String field) {
        ObjectNode body = validBody(); body.putNull(field);
        assertThatThrownBy(() -> read(body)).isInstanceOf(MismatchedInputException.class);
    }

    static Stream<Arguments> wrongJsonTypes() {
        return Stream.of("displayName", "email", "password", "confirmPassword")
                .flatMap(field -> Stream.of("0", "1.5", "true", "false", "[]", "{}", "[\"string\"]")
                        .map(value -> Arguments.of(field, value)));
    }
    @ParameterizedTest(name="{index}")
    @MethodSource("wrongJsonTypes")
    void rejectsWrongJsonTypesInsteadOfCoercingStrings(String field, String value) throws Exception {
        ObjectNode body = validBody(); body.set(field, json.readTree(value));
        assertThatThrownBy(() -> read(body)).isInstanceOf(MismatchedInputException.class);
    }

    @ParameterizedTest(name="{index}")
    @ValueSource(strings={"role", "enabled", "id", "unknown", "Password", "displayNameForValidation",
            "emailForValidation", "displayNameLengthValid", "passwordCharacterLengthValid",
            "passwordUtf8LengthValid", "passwordConfirmationValid"})
    void rejectsUnknownFieldsIncludingAttemptsToOverrideValidationGetters(String field) {
        assertThat(json.isEnabled(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)).isTrue();
        ObjectNode body = validBody().put(field, true);
        assertThatThrownBy(() -> read(body)).isInstanceOf(UnrecognizedPropertyException.class);
    }

    @Test void validationMessagesAndRepresentationsNeverContainPasswordValues() throws Exception {
        String password = "private-fixture-value-".repeat(4), confirmation = "different-private-fixture-value";
        RegistrationRequest request = read(validBody().put("password", password).put("confirmPassword", confirmation));
        assertThat(request.toString()).isEqualTo("RegistrationRequest[redacted]");
        assertThat(request.toString()).doesNotContain(password, confirmation);
        assertThat(validator.validate(request).size()).isGreaterThan(0);
        for (ConstraintViolation<RegistrationRequest> violation : validator.validate(request)) {
            assertThat(violation.getMessage()).doesNotContain(password, confirmation);
            assertThat(violation.getMessageTemplate()).doesNotContain(password, confirmation);
        }
        String serialized = json.writeValueAsString(request);
        assertThat(serialized).doesNotContain(password, confirmation, "password", "confirmPassword");
        assertThat(json.readTree(serialized).properties()).extracting(java.util.Map.Entry::getKey)
                .containsExactlyInAnyOrder("displayName", "email");
    }
}
