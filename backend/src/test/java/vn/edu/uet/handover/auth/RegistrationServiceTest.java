package vn.edu.uet.handover.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.TransactionSystemException;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vn.edu.uet.handover.common.ApiException;

class RegistrationServiceTest {
    static final ObjectMapper json=new ObjectMapper();
    static ValidatorFactory factory;
    static Validator validator;
    UserRepository users;
    PasswordEncoder passwords;
    PlatformTransactionManager manager;
    RegistrationService service;

    @BeforeAll static void startValidation() {
        factory=Validation.buildDefaultValidatorFactory(); validator=factory.getValidator();
    }
    @AfterAll static void closeValidation() { factory.close(); }
    @BeforeEach void setup() {
        users=mock(UserRepository.class);
        // Use the existing configuration's encoder and cost, not a second production encoder.
        passwords=spy(new SecurityConfig(json,users).passwordEncoder());
        manager=mock(PlatformTransactionManager.class);
        when(manager.getTransaction(any(TransactionDefinition.class))).thenAnswer(call -> new SimpleTransactionStatus());
        when(users.insertRegisteredUser(any(UUID.class),anyString(),anyString(),anyString()))
                .thenAnswer(call -> Optional.of(new PortalUser.UserView(call.getArgument(0),call.getArgument(1),call.getArgument(2))));
        service=new RegistrationService(users,passwords,validator,manager);
    }
    @AfterEach void clearContexts() { SecurityContextHolder.clearContext(); RequestContextHolder.resetRequestAttributes(); }

    static ObjectNode body() {
        return json.createObjectNode().put("displayName","  Nguyen Van A  ").put("email","  Person@Example.TEST  ")
                .put("password","  ExactFixture123  ").put("confirmPassword","  ExactFixture123  ");
    }
    static RegistrationRequest read(ObjectNode body) throws Exception {
        return json.readValue(json.writeValueAsBytes(body),RegistrationRequest.class);
    }
    void code(Runnable action,HttpStatus status,String code) {
        assertThatThrownBy(action::run).isInstanceOfSatisfying(ApiException.class,e -> {
            assertThat(e.status()).isEqualTo(status); assertThat(e.code()).isEqualTo(code);
        });
    }

    @Test void registersNormalizedUserWithExistingBcryptAndReturnsOnlyThePublicView() throws Exception {
        RegistrationRequest input=read(body());
        PortalUser.UserView result=service.register(input);
        ArgumentCaptor<UUID> id=ArgumentCaptor.forClass(UUID.class);
        ArgumentCaptor<String> hash=ArgumentCaptor.forClass(String.class);
        verify(users).existsByEmail("person@example.test");
        verify(users).insertRegisteredUser(id.capture(),eq("person@example.test"),eq("Nguyen Van A"),hash.capture());
        assertThat(result).isEqualTo(new PortalUser.UserView(id.getValue(),"person@example.test","Nguyen Van A"));
        assertThat(id.getValue()).isNotNull();
        assertThat(hash.getValue()).isNotEqualTo(input.password()).matches("\\$2[aby]\\$12\\$.*");
        assertThat(passwords.matches(input.password(),hash.getValue())).isTrue();
        assertThat(passwords.matches(input.password().trim(),hash.getValue())).isFalse();
        verify(passwords).encode(input.password());
        assertThat(input.email()).isEqualTo("  Person@Example.TEST  ");
        assertThat(input.displayName()).isEqualTo("  Nguyen Van A  ");
        String serialized=json.writeValueAsString(result);
        assertThat(json.readTree(serialized).properties()).extracting(java.util.Map.Entry::getKey)
                .containsExactlyInAnyOrder("id","email","displayName");
        assertThat(serialized).doesNotContain(input.password(),input.confirmPassword(),hash.getValue(),"password","token","session");
        assertThat(result.toString()).doesNotContain(input.password(),hash.getValue());
        verifyNoMoreInteractions(users);
    }

    @Test void normalizationUsesLocaleRootAndStripsUnicodeNamePadding() throws Exception {
        Locale before=Locale.getDefault();
        try {
            Locale.setDefault(Locale.forLanguageTag("tr-TR"));
            var result=service.register(read(body().put("email"," I@example.TEST ").put("displayName","\u2003 Name \u2003")));
            assertThat(result.email()).isEqualTo("i@example.test"); assertThat(result.displayName()).isEqualTo("Name");
        } finally { Locale.setDefault(before); }
    }

    @Test void rejectsNullInputBeforeAnyDatabaseOrPasswordOperation() {
        code(() -> service.register(null),HttpStatus.BAD_REQUEST,"VALIDATION_ERROR");
        verifyNoInteractions(users,passwords,manager);
    }

    static Stream<RegistrationRequest> invalidInputs() throws Exception {
        var values=new java.util.ArrayList<RegistrationRequest>();
        for (String field:List.of("displayName","email","password","confirmPassword")) {
            ObjectNode value=body(); value.remove(field); values.add(read(value));
        }
        for (String name:List.of("", "\u00a0", "n".repeat(101))) values.add(read(body().put("displayName",name)));
        for (String email:List.of("", "not-email", "a".repeat(255))) values.add(read(body().put("email",email)));
        for (String password:List.of("1234567", " ".repeat(8), "\u00a0".repeat(8), "a".repeat(73), "á".repeat(36)+"a", "😀".repeat(4)))
            values.add(read(body().put("password",password).put("confirmPassword",password)));
        values.add(read(body().put("confirmPassword","different-fixture-value")));
        return values.stream();
    }
    @ParameterizedTest(name="{index}") @MethodSource("invalidInputs")
    void rejectsR01ValidationFailuresBeforeLookupHashOrInsert(RegistrationRequest input) {
        assertThatThrownBy(() -> service.register(input)).isInstanceOfSatisfying(ApiException.class,e -> {
            assertThat(e.status()).isEqualTo(HttpStatus.BAD_REQUEST); assertThat(e.code()).isEqualTo("VALIDATION_ERROR");
            assertThat(e.getMessage()).isEqualTo("Invalid request fields or format");
        });
        verifyNoInteractions(users,passwords,manager);
    }

    @Test void rechecksEmailLengthAfterUnicodeLowercaseExpansion() throws Exception {
        String email="İ"+"a".repeat(63)+"@"+"b".repeat(63)+"."+"c".repeat(63)+"."+"d".repeat(61);
        RegistrationRequest input=read(body().put("email",email));
        assertThat(validator.validate(input).size()).isZero();
        assertThat(email.toLowerCase(Locale.ROOT).length()).isEqualTo(255);
        code(() -> service.register(input),HttpStatus.BAD_REQUEST,"VALIDATION_ERROR");
        verifyNoInteractions(users,passwords,manager);
    }

    @Test void existingEmailIsRejectedWithoutHashingOrWritingOverTheOldUser() throws Exception {
        when(users.existsByEmail("person@example.test")).thenReturn(true);
        RegistrationRequest input=read(body());
        code(() -> service.register(input),HttpStatus.CONFLICT,"EMAIL_ALREADY_EXISTS");
        verify(users).existsByEmail("person@example.test"); verifyNoMoreInteractions(users);
        verifyNoInteractions(passwords,manager);
    }

    @Test void conflictReportedByTheExactDatabaseConstraintBecomesTheSameBusinessError() throws Exception {
        when(users.insertRegisteredUser(any(UUID.class),anyString(),anyString(),anyString())).thenReturn(Optional.empty());
        RegistrationRequest input=read(body());
        code(() -> service.register(input),HttpStatus.CONFLICT,"EMAIL_ALREADY_EXISTS");
        verify(manager).commit(any(TransactionStatus.class));
        verify(manager,never()).rollback(any(TransactionStatus.class));
    }

    static Stream<RuntimeException> unrelatedDatabaseFailures() {
        return Stream.of(new DataIntegrityViolationException("unrelated check violation"),
                new DuplicateKeyException("unrelated primary key violation"),new DataAccessResourceFailureException("database offline"));
    }
    @ParameterizedTest(name="{index}") @MethodSource("unrelatedDatabaseFailures")
    void doesNotMislabelOtherInsertFailuresAsDuplicateEmail(RuntimeException failure) throws Exception {
        when(users.insertRegisteredUser(any(UUID.class),anyString(),anyString(),anyString())).thenThrow(failure);
        RegistrationRequest input=read(body());
        assertThatThrownBy(() -> service.register(input)).isSameAs(failure);
    }

    @Test void databaseLookupOutageIsNotAConflictAndNeverHashesOrInserts() throws Exception {
        var failure=new DataAccessResourceFailureException("database offline");
        when(users.existsByEmail(anyString())).thenThrow(failure);
        RegistrationRequest input=read(body());
        assertThatThrownBy(() -> service.register(input)).isSameAs(failure);
        verify(users).existsByEmail("person@example.test"); verifyNoMoreInteractions(users);
        verifyNoInteractions(passwords,manager);
    }

    @Test void encoderFailureNeverReachesTheInsertTransaction() throws Exception {
        var failure=new IllegalStateException("encoder unavailable");
        doThrow(failure).when(passwords).encode(anyString());
        RegistrationRequest input=read(body());
        assertThatThrownBy(() -> service.register(input)).isSameAs(failure);
        verify(users).existsByEmail("person@example.test"); verifyNoMoreInteractions(users); verifyNoInteractions(manager);
    }

    @Test void commitFailureNeverReturnsAnApparentSuccess() throws Exception {
        var failure=new TransactionSystemException("commit unavailable");
        doThrow(failure).when(manager).commit(any(TransactionStatus.class));
        RegistrationRequest input=read(body());
        assertThatThrownBy(() -> service.register(input)).isSameAs(failure);
    }

    @ParameterizedTest(name="{index}") @ValueSource(booleans={false,true})
    void neverCreatesALoginSessionOrChangesAnExistingPrincipal(boolean authenticated) throws Exception {
        var request=new MockHttpServletRequest();
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        var auth=authenticated?UsernamePasswordAuthenticationToken.authenticated("prior-user",null,List.of()):null;
        SecurityContextHolder.getContext().setAuthentication(auth);
        service.register(read(body()));
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isSameAs(auth);
        assertThat(request.getSession(false)).isNull();
    }

    @Test void distinctRegistrationsReceiveFreshUuidsAndSaltedHashes() throws Exception {
        var first=service.register(read(body().put("email","first@example.test")));
        var second=service.register(read(body().put("email","second@example.test")));
        ArgumentCaptor<String> hashes=ArgumentCaptor.forClass(String.class);
        verify(users,times(2)).insertRegisteredUser(any(UUID.class),anyString(),anyString(),hashes.capture());
        assertThat(first.id()).isNotEqualTo(second.id());
        assertThat(hashes.getAllValues().get(0)).isNotEqualTo(hashes.getAllValues().get(1));
        for (String hash:hashes.getAllValues()) assertThat(passwords.matches("  ExactFixture123  ",hash)).isTrue();
    }
}
