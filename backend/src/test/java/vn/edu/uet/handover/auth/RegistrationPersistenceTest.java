package vn.edu.uet.handover.auth;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.validation.Validator;
import java.sql.SQLException;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vn.edu.uet.handover.common.ApiException;

/** RUN_DB_TESTS only on a dedicated disposable PostgreSQL database, never a shared DB. */
@SpringBootTest(properties="app.upload.expiry-delay-ms=3600000")
@EnabledIfEnvironmentVariable(named="RUN_DB_TESTS",matches="true")
class RegistrationPersistenceTest {
    @Autowired RegistrationService service;
    @Autowired UserRepository users;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder passwords;
    @Autowired Validator validator;
    @Autowired PlatformTransactionManager manager;
    @Autowired ObjectMapper json;
    final Set<String> ownedEmails=new LinkedHashSet<>();
    String prefix;
    long projectsBefore,membershipsBefore;

    @BeforeEach void isolateTestIdentities() {
        prefix="r02-"+UUID.randomUUID(); ownedEmails.clear();
        projectsBefore=count("SELECT count(*) FROM projects");
        membershipsBefore=count("SELECT count(*) FROM memberships");
    }
    @AfterEach void verifySideEffectsAndRemoveOnlyOwnedUsers() {
        try {
            assertThat(count("SELECT count(*) FROM projects")).isEqualTo(projectsBefore);
            assertThat(count("SELECT count(*) FROM memberships")).isEqualTo(membershipsBefore);
        } finally {
            // No TRUNCATE/CASCADE or deletion of unrelated seeded users.
            for (String email:ownedEmails) jdbc.update("DELETE FROM app_users WHERE email = ?",email);
        }
    }
    long count(String sql,Object... args) { return jdbc.queryForObject(sql,Long.class,args); }
    String email(String suffix) {
        String value=prefix+"-"+suffix+"@example.test"; ownedEmails.add(value); return value;
    }
    RegistrationRequest request(String email,String name,String password) throws Exception {
        return read(json.createObjectNode().put("email",email).put("displayName",name)
                .put("password",password).put("confirmPassword",password));
    }
    RegistrationRequest read(ObjectNode body) throws Exception {
        return json.readValue(json.writeValueAsBytes(body),RegistrationRequest.class);
    }
    void duplicate(Runnable action) {
        assertThatThrownBy(action::run).isInstanceOfSatisfying(ApiException.class,e -> {
            assertThat(e.status()).isEqualTo(HttpStatus.CONFLICT); assertThat(e.code()).isEqualTo("EMAIL_ALREADY_EXISTS");
        });
    }
    SQLException sqlCause(Throwable error) {
        for (Throwable cause=error;cause!=null;cause=cause.getCause())
            if (cause instanceof SQLException sql && sql.getSQLState()!=null) return sql;
        throw new AssertionError("PostgreSQL diagnostic was not preserved");
    }

    @Test void persistsCommittedUserCompatibleWithTheExistingLoginRepository() throws Exception {
        String email=email("new"),rawPassword="  ExactFixture123  ";
        var view=service.register(request("  "+email.toUpperCase(Locale.ROOT)+"  ","\u2003 New User \u2003",rawPassword));
        PortalUser loaded=(PortalUser)users.loadUserByUsername(" "+email.toUpperCase(Locale.ROOT)+" ");
        assertThat(loaded.id()).isEqualTo(view.id()); assertThat(loaded.getUsername()).isEqualTo(email);
        assertThat(loaded.view()).isEqualTo(new PortalUser.UserView(view.id(),email,"New User"));
        assertThat(loaded.isEnabled()).isTrue(); assertThat(users.exists(view.id())).isTrue();
        assertThat(loaded.getAuthorities()).isEmpty();
        assertThat(loaded.getPassword()).isNotEqualTo(rawPassword).matches("\\$2[aby]\\$12\\$.*");
        assertThat(passwords.matches(rawPassword,loaded.getPassword())).isTrue();
        assertThat(passwords.matches(rawPassword.trim(),loaded.getPassword())).isFalse();
        assertThat(count("SELECT count(*) FROM app_users WHERE email = ? AND enabled",email)).isEqualTo(1);
        assertThat(json.valueToTree(view).properties()).extracting(java.util.Map.Entry::getKey)
                .containsExactlyInAnyOrder("id","email","displayName");
        assertThat(json.writeValueAsString(view)).doesNotContain(rawPassword,loaded.getPassword(),"password","session","token");
    }

    @Test void duplicateNormalizedEmailCannotOverwriteAnExistingUser() throws Exception {
        String email=email("duplicate");
        var first=service.register(request(email,"Original","OriginalFixture123"));
        PortalUser before=(PortalUser)users.loadUserByUsername(email);
        RegistrationRequest second=request(" "+email.toUpperCase(Locale.ROOT)+" ","Replacement","DifferentFixture123");
        duplicate(() -> service.register(second));
        PortalUser after=(PortalUser)users.loadUserByUsername(email);
        assertThat(after.id()).isEqualTo(first.id()); assertThat(after.view()).isEqualTo(before.view());
        assertThat(after.getPassword()).isEqualTo(before.getPassword());
        assertThat(count("SELECT count(*) FROM app_users WHERE email = ?",email)).isEqualTo(1);
    }

    @Test void disabledEmailRemainsReservedAndIsNeverReenabledOrReset() throws Exception {
        String email=email("disabled");var first=service.register(request(email,"Disabled","DisabledFixture123"));
        jdbc.update("UPDATE app_users SET enabled=false WHERE id=?",first.id());
        PortalUser before=(PortalUser)users.loadUserByUsername(email);
        assertThat(users.existsByEmail(email)).isTrue(); assertThat(users.exists(first.id())).isFalse();
        RegistrationRequest second=request(email,"Replacement","ReplacementFixture123");duplicate(() -> service.register(second));
        PortalUser after=(PortalUser)users.loadUserByUsername(email);
        assertThat(after.isEnabled()).isFalse(); assertThat(after.id()).isEqualTo(before.id());
        assertThat(after.view()).isEqualTo(before.view()); assertThat(after.getPassword()).isEqualTo(before.getPassword());
    }

    record Outcome(PortalUser.UserView view,String code,HttpStatus status) {}
    Outcome attempt(RegistrationService target,RegistrationRequest input) {
        try { return new Outcome(target.register(input),null,null); }
        catch (ApiException e) { return new Outcome(null,e.code(),e.status()); }
    }
    @Test void competingRegistrationsBothPassPrecheckButOnlyOneCommits() throws Exception {
        String email=email("race");var barrier=new CyclicBarrier(2);var absentReads=new AtomicInteger();
        UserRepository coordinated=new UserRepository(jdbc) {
            @Override public boolean existsByEmail(String value) {
                boolean exists=super.existsByEmail(value);
                if (email.equals(value)) {
                    if (!exists) absentReads.incrementAndGet();
                    try { barrier.await(10,TimeUnit.SECONDS); }
                    catch (Exception e) { throw new IllegalStateException("Concurrent precheck did not rendezvous",e); }
                }
                return exists;
            }
        };
        // Real JDBC, transactions, Validator and configured BCrypt; only read scheduling is coordinated.
        var concurrent=new RegistrationService(coordinated,passwords,validator,manager);
        var first=request(" "+email.toUpperCase(Locale.ROOT)+" ","First contender","RaceAlphaFixture123");
        var second=request(email,"Second contender","RaceBetaFixture123");
        var executor=Executors.newFixedThreadPool(2);
        try {
            var a=executor.submit(() -> attempt(concurrent,first));
            var b=executor.submit(() -> attempt(concurrent,second));
            List<Outcome> results=List.of(a.get(30,TimeUnit.SECONDS),b.get(30,TimeUnit.SECONDS));
            assertThat(absentReads.get()).isEqualTo(2);
            assertThat(results.stream().filter(r -> r.view()!=null).count()).isEqualTo(1);
            assertThat(results.stream().filter(r -> "EMAIL_ALREADY_EXISTS".equals(r.code()) && r.status()==HttpStatus.CONFLICT).count()).isEqualTo(1);
            PortalUser stored=(PortalUser)users.loadUserByUsername(email);
            var winner=results.stream().filter(r -> r.view()!=null).findFirst().orElseThrow().view();
            assertThat(stored.view()).isEqualTo(winner);
            boolean firstWon=winner.displayName().equals("First contender");
            assertThat(passwords.matches(firstWon?first.password():second.password(),stored.getPassword())).isTrue();
            assertThat(passwords.matches(firstWon?second.password():first.password(),stored.getPassword())).isFalse();
            assertThat(count("SELECT count(*) FROM app_users WHERE email = ?",email)).isEqualTo(1);
            // The losing request did not leave the database/transaction state unusable.
            assertThat(service.register(request(email("after-race"),"After race","AfterRaceFixture123")).id()).isNotNull();
        } finally { executor.shutdownNow(); assertThat(executor.awaitTermination(10,TimeUnit.SECONDS)).isTrue(); }
    }

    @Test void schemaEmailConstraintStillRejectsDuplicateRawInserts() throws Exception {
        String email=email("constraint");service.register(request(email,"Original","ConstraintFixture123"));
        String hash=((PortalUser)users.loadUserByUsername(email)).getPassword();
        assertThat(jdbc.queryForObject("SELECT contype::text FROM pg_constraint WHERE conname='uq_user_email' AND conrelid='app_users'::regclass",String.class)).isEqualTo("u");
        Throwable failure=catchThrowable(() -> jdbc.update("INSERT INTO app_users(id,email,display_name,password_hash) VALUES (?,?,?,?)",UUID.randomUUID(),email,"Other",hash));
        assertThat(failure).isInstanceOf(DataIntegrityViolationException.class);
        assertThat(sqlCause(failure).getSQLState()).isEqualTo("23505");
        assertThat(sqlCause(failure).getMessage()).contains("uq_user_email");
        assertThat(count("SELECT count(*) FROM app_users WHERE email = ?",email)).isEqualTo(1);
    }

    @Test void targetedEmailConflictLeavesTheCurrentTransactionUsableAndOriginalDataUntouched() throws Exception {
        String email=email("atomic");var first=service.register(request(email,"Original","AtomicFixture123"));
        String originalHash=((PortalUser)users.loadUserByUsername(email)).getPassword();
        new TransactionTemplate(manager).executeWithoutResult(status -> {
            assertThat(users.insertRegisteredUser(UUID.randomUUID(),email,"Replacement",originalHash)).isEmpty();
            assertThat(jdbc.queryForObject("SELECT 1",Integer.class)).isEqualTo(1);
        });
        PortalUser after=(PortalUser)users.loadUserByUsername(email);
        assertThat(after.view()).isEqualTo(first); assertThat(after.getPassword()).isEqualTo(originalHash);
    }

    @Test void unrelatedPrimaryKeyViolationIsNotSuppressedAsAnEmailConflict() throws Exception {
        String firstEmail=email("pk-first"),secondEmail=email("pk-second");
        var first=service.register(request(firstEmail,"Original","PrimaryFixture123"));
        String hash=((PortalUser)users.loadUserByUsername(firstEmail)).getPassword();
        Throwable failure=catchThrowable(() -> users.insertRegisteredUser(first.id(),secondEmail,"Different",hash));
        assertThat(failure).isInstanceOf(DataIntegrityViolationException.class);
        assertThat(sqlCause(failure).getSQLState()).isEqualTo("23505");
        assertThat(sqlCause(failure).getMessage()).contains("app_users_pkey");
        assertThat(count("SELECT count(*) FROM app_users WHERE email = ?",secondEmail)).isZero();
    }

    @Test void unrelatedCheckAndNotNullViolationsArePreserved() throws Exception {
        String checkEmail=email("check"),nullEmail=email("not-null");
        String hash=passwords.encode("DatabaseFixture123");
        Throwable check=catchThrowable(() -> users.insertRegisteredUser(UUID.randomUUID(),checkEmail," ",hash));
        assertThat(check).isInstanceOf(DataIntegrityViolationException.class);
        assertThat(sqlCause(check).getSQLState()).isEqualTo("23514");
        Throwable missing=catchThrowable(() -> users.insertRegisteredUser(UUID.randomUUID(),nullEmail,"Name",null));
        assertThat(missing).isInstanceOf(DataIntegrityViolationException.class);
        assertThat(sqlCause(missing).getSQLState()).isEqualTo("23502");
        assertThat(users.existsByEmail(checkEmail)).isFalse(); assertThat(users.existsByEmail(nullEmail)).isFalse();
    }

    @Test void registrationRollsBackWithAnEnclosingTransaction() throws Exception {
        String email=email("rollback");RegistrationRequest input=request(email,"Rollback","RollbackFixture123");
        var failure=new IllegalStateException("test rollback");
        assertThatThrownBy(() -> new TransactionTemplate(manager).executeWithoutResult(status -> {
            service.register(input); throw failure;
        })).isSameAs(failure);
        assertThat(users.existsByEmail(email)).isFalse();
        assertThat(service.register(input).id()).isNotNull();
    }

    @Test void sqlCharactersInDisplayNameAreStoredAsDataWithoutChangingSchema() throws Exception {
        String email=email("sql");String name="A'); DROP TABLE app_users; --";
        var created=service.register(request(email,name,"BindingFixture123"));
        assertThat(((PortalUser)users.loadUserByUsername(email)).view()).isEqualTo(created);
        assertThat(created.displayName()).isEqualTo(name);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM pg_constraint WHERE conname='uq_user_email' AND conrelid='app_users'::regclass",Integer.class)).isEqualTo(1);
    }

    @Test void persistsFullUtf8BoundaryPasswordAndHundredCodePointDisplayName() throws Exception {
        String email=email("boundary"),name="😀".repeat(100),raw="  "+"á".repeat(34)+"  ";
        var created=service.register(request(email,name,raw));
        PortalUser loaded=(PortalUser)users.loadUserByUsername(email);
        assertThat(created.displayName()).isEqualTo(name);
        assertThat(passwords.matches(raw,loaded.getPassword())).isTrue();
        assertThat(passwords.matches(raw.trim(),loaded.getPassword())).isFalse();
    }

    @Test void serviceValidationPreventsInvalidInputsFromReachingTheDatabase() throws Exception {
        String email=email("invalid");long before=count("SELECT count(*) FROM app_users");
        for (ObjectNode value:List.of(
                json.createObjectNode(),
                json.createObjectNode().put("email",email).put("displayName","Name").put("password","short").put("confirmPassword","short"),
                json.createObjectNode().put("email",email).put("displayName","Name").put("password","á".repeat(36)+"a").put("confirmPassword","á".repeat(36)+"a"),
                json.createObjectNode().put("email",email).put("displayName","Name").put("password","ValidFixture123").put("confirmPassword","DifferentFixture123"))) {
            RegistrationRequest input=read(value);
            assertThatThrownBy(() -> service.register(input)).isInstanceOfSatisfying(ApiException.class,e -> {
                assertThat(e.status()).isEqualTo(HttpStatus.BAD_REQUEST);assertThat(e.code()).isEqualTo("VALIDATION_ERROR");
            });
        }
        assertThat(count("SELECT count(*) FROM app_users")).isEqualTo(before);
    }
}
