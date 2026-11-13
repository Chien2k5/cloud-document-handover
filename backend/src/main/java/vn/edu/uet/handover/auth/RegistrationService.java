package vn.edu.uet.handover.auth;

import jakarta.validation.Validator;
import java.util.Locale;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vn.edu.uet.handover.common.ApiException;

@Service
public class RegistrationService {
    private final UserRepository users;
    private final PasswordEncoder passwords;
    private final Validator validator;
    private final TransactionTemplate tx;

    public RegistrationService(UserRepository users, PasswordEncoder passwords, Validator validator,
            PlatformTransactionManager manager) {
        this.users=users; this.passwords=passwords; this.validator=validator;
        this.tx=new TransactionTemplate(manager);
    }

    public PortalUser.UserView register(RegistrationRequest input) {
        // Validate service callers too; never include rejected values in errors or logs.
        if (input == null || !validator.validate(input).isEmpty()) throw invalid();
        String email=input.email().trim().toLowerCase(Locale.ROOT);
        String displayName=input.displayName().strip();
        // Lowercasing Unicode can expand the value beyond the original DTO length.
        if (!validator.validateValue(RegistrationRequest.class,"email",email).isEmpty()) throw invalid();
        if (users.existsByEmail(email)) throw duplicate();
        String hash=passwords.encode(input.password());
        // Hash outside the DB transaction; the unique constraint closes the pre-check race.
        var created=tx.execute(status -> users.insertRegisteredUser(UUID.randomUUID(),email,displayName,hash));
        return created.orElseThrow(RegistrationService::duplicate);
    }

    private static ApiException invalid() {
        return new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid request fields or format");
    }
    private static ApiException duplicate() {
        return new ApiException(HttpStatus.CONFLICT,"EMAIL_ALREADY_EXISTS","Email is already registered");
    }
}
