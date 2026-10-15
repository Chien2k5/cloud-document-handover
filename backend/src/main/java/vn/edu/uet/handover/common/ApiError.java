package vn.edu.uet.handover.common;

public record ApiError(String code, String message, String requestId) {}
