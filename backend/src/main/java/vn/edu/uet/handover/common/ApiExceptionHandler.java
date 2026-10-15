package vn.edu.uet.handover.common;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;
import org.springframework.web.HttpRequestMethodNotSupportedException;

@RestControllerAdvice
public class ApiExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);
    @ExceptionHandler(ApiException.class)
    ResponseEntity<ApiError> api(ApiException e, HttpServletRequest r) {
        return response(e.status(), e.code(), e.getMessage(), r);
    }
    @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class})
    ResponseEntity<ApiError> invalid(Exception e, HttpServletRequest r) {
        return response(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Invalid request fields or format", r);
    }
    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<ApiError> conflict(Exception e, HttpServletRequest r) {
        return response(HttpStatus.CONFLICT, "DATA_CONFLICT", "Request conflicts with existing data", r);
    }
    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<ApiError> missing(Exception e, HttpServletRequest r) {
        return response(HttpStatus.NOT_FOUND, "NOT_FOUND", "Endpoint not implemented or not found", r);
    }
    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<ApiError> method(Exception e, HttpServletRequest r) {
        return response(HttpStatus.METHOD_NOT_ALLOWED, "METHOD_NOT_ALLOWED", "HTTP method not supported", r);
    }
    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiError> unexpected(Exception e, HttpServletRequest r) {
        // Do not log payloads, SQL parameters or credentials.
        log.error("Request {} failed: {}", RequestIdFilter.id(r), e.getClass().getSimpleName());
        return response(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Request could not be processed", r);
    }
    private ResponseEntity<ApiError> response(HttpStatus status, String code, String message, HttpServletRequest r) {
        return ResponseEntity.status(status).body(new ApiError(code, message, RequestIdFilter.id(r)));
    }
}
