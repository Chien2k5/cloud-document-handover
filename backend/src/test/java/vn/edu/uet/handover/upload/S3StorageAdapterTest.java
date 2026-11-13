package vn.edu.uet.handover.upload;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.time.Clock;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.awscore.exception.AwsErrorDetails;
import software.amazon.awssdk.core.ResponseInputStream;
import software.amazon.awssdk.core.exception.SdkClientException;
import software.amazon.awssdk.http.AbortableInputStream;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import vn.edu.uet.handover.upload.StoragePort.ObjectRef;
import vn.edu.uet.handover.upload.StoragePort.PutSpec;
import vn.edu.uet.handover.upload.StoragePort.Unavailable;

class S3StorageAdapterTest {
    private static final ObjectRef REF = new ObjectRef("fixture-bucket", "uploads/a +%=.pdf", "v+/=%");

    @Test
    void signerRequiresConditionalHeadersAndPinsTheDownloadVersion() {
        try (var signer = S3Presigner.builder().region(Region.AP_SOUTHEAST_1)
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create("fixture", "fixture")))
                .build()) {
            var adapter = new S3StorageAdapter(null, signer, Clock.systemUTC());
            var deadline = Instant.now().plusSeconds(45);
            var put = adapter.presignPut(new PutSpec(REF.bucket(), REF.objectKey(), "application/pdf", 12, deadline));

            assertThat(put.method()).isEqualTo("PUT");
            assertThat(put.requiredHeaders()).hasSize(2);
            assertThat(put.requiredHeaders()).containsEntry("content-type", "application/pdf")
                    .containsEntry("if-none-match", "*");
            assertThat(put.url()).contains("X-Amz-SignedHeaders=content-type%3Bhost%3Bif-none-match");
            assertThat(put.expiresAt()).isBeforeOrEqualTo(deadline);

            var get = adapter.presignGet(REF, deadline);
            assertThat(get.method()).isEqualTo("GET");
            assertThat(get.requiredHeaders()).isEmpty();
            assertThat(get.url()).contains("versionId=v%2B%2F%3D%25", "response-content-disposition=attachment");
        }
    }

    @Test
    void headChecksExactIdentityAndChecksumDistinguishesMissingFromDenied() {
        S3Client client = mock(S3Client.class);
        var adapter = new S3StorageAdapter(client, null, Clock.systemUTC());
        when(client.headObject(any(HeadObjectRequest.class)))
                .thenReturn(HeadObjectResponse.builder().versionId(REF.versionId())
                        .contentLength(12L).contentType("application/pdf").build())
                .thenReturn(HeadObjectResponse.builder().versionId("wrong").contentLength(12L).build());

        assertThat(adapter.headVersion(REF)).hasValueSatisfying(head -> assertThat(head.ref()).isEqualTo(REF));
        var headRequest = ArgumentCaptor.forClass(HeadObjectRequest.class);
        verify(client).headObject(headRequest.capture());
        assertThat(headRequest.getValue().versionId()).isEqualTo(REF.versionId());
        assertThatThrownBy(() -> adapter.headVersion(REF)).isInstanceOf(Unavailable.class);

        when(client.getObject(any(GetObjectRequest.class)))
                .thenThrow(error(404, "NoSuchKey"))
                .thenThrow(error(403, "AccessDenied"));
        assertThat(adapter.readChecksum(REF)).isEmpty();
        var getRequest = ArgumentCaptor.forClass(GetObjectRequest.class);
        verify(client).getObject(getRequest.capture());
        assertThat(getRequest.getValue().key()).isEqualTo(
                "results/fbbc3334e2325e09e43cb32dd41ba6e63d0f3ffad0bf108a1cb0db971610f8b7/552e151a9beecf2fac5516946aeda4c549ef15326dc59f62256c776c527cbeac/ca01fa40730897dffb94f2dec149a942d49c1c9ec9c95f1ddf0db7cc9328a85e.json");
        assertThatThrownBy(() -> adapter.readChecksum(REF)).isInstanceOf(Unavailable.class);
    }

    @Test
    void checksumRejectsOversizedResultsAndTreatsTruncatedReadsAsUnavailable() {
        int limit = 64 * 1024;
        byte[] atLimit = new byte[limit];
        S3Client client = mock(S3Client.class);
        var adapter = new S3StorageAdapter(client, null, Clock.systemUTC());
        Runnable abort = mock(Runnable.class);
        when(client.getObject(any(GetObjectRequest.class)))
                .thenReturn(checksumBody(limit, atLimit, () -> {}))
                .thenReturn(checksumBody(limit + 1, new byte[0], abort))
                .thenReturn(checksumBody(2, new byte[]{1}, () -> {}));

        assertThat(adapter.readChecksum(REF)).hasValueSatisfying(bytes -> assertThat(bytes).isEqualTo(atLimit));
        assertThat(adapter.readChecksum(REF)).hasValueSatisfying(bytes -> assertThat(bytes).isEmpty());
        verify(abort).run();
        assertThatThrownBy(() -> adapter.readChecksum(REF)).isInstanceOf(Unavailable.class);
    }

    @Test
    void springKeepsS3OptInAndWiresExactlyOneStoragePortWhenEnabled() {
        var context = new ApplicationContextRunner()
                .withUserConfiguration(UploadConfiguration.class, S3StorageConfiguration.class);
        context.run(application -> {
            assertThat(application).hasSingleBean(StoragePort.class).doesNotHaveBean(S3Client.class);
            assertThatThrownBy(() -> application.getBean(StoragePort.class).headVersion(REF))
                    .isInstanceOf(Unavailable.class);
        });
        context.withPropertyValues("app.upload.s3-enabled=true", "app.upload.s3-region=ap-southeast-2",
                "app.upload.bucket=fixture-bucket").run(application -> {
                    assertThat(application).hasSingleBean(StoragePort.class).hasSingleBean(S3Client.class);
                    assertThat(application.getBean(StoragePort.class)).isInstanceOf(S3StorageAdapter.class);
                });
        context.withPropertyValues("app.upload.s3-enabled=true", "app.upload.s3-region=",
                "app.upload.bucket=").run(application -> {
                    assertThat(application).hasFailed();
                    assertThat(application.getStartupFailure()).hasRootCauseMessage(
                            "AWS_REGION and UPLOAD_BUCKET are required for S3");
                });
    }

    @Test
    void storageErrorsAreUnavailableAndExactHeadMissingIsDistinct() {
        S3Client client=mock(S3Client.class);
        var adapter=new S3StorageAdapter(client,null,Clock.systemUTC());
        when(client.headObject(any(HeadObjectRequest.class)))
                .thenThrow(error(404,"NoSuchVersion")).thenThrow(error(405,"MethodNotAllowed"))
                .thenThrow(error(403,"AccessDenied")).thenThrow(error(503,"SlowDown"))
                .thenThrow(SdkClientException.create("fixture timeout"));
        assertThat(adapter.headVersion(REF)).isEmpty();
        assertThat(adapter.headVersion(REF)).isEmpty();
        for(int i=0;i<3;i++) assertThatThrownBy(()->adapter.headVersion(REF)).isInstanceOf(Unavailable.class);
        when(client.getObject(any(GetObjectRequest.class)))
                .thenThrow(error(404,"NoSuchBucket")).thenThrow(error(503,"SlowDown"))
                .thenThrow(SdkClientException.create("fixture timeout"));
        for(int i=0;i<3;i++) assertThatThrownBy(()->adapter.readChecksum(REF)).isInstanceOf(Unavailable.class);
    }

    @Test
    void checksumClosesSuccessfulBodyAndAbortsReadFailures() {
        S3Client client=mock(S3Client.class);
        var adapter=new S3StorageAdapter(client,null,Clock.systemUTC());
        AtomicBoolean closed=new AtomicBoolean();
        var success=new ByteArrayInputStream(new byte[]{1}) {
            @Override public void close() throws IOException { closed.set(true);super.close(); }
        };
        Runnable abort=mock(Runnable.class);
        InputStream broken=new InputStream() {
            @Override public int read() throws IOException { throw new IOException("fixture interrupted stream"); }
        };
        when(client.getObject(any(GetObjectRequest.class)))
                .thenReturn(new ResponseInputStream<>(GetObjectResponse.builder().contentLength(1L).build(),
                        AbortableInputStream.create(success)))
                .thenReturn(new ResponseInputStream<>(GetObjectResponse.builder().contentLength(1L).build(),
                        AbortableInputStream.create(broken,abort::run)));
        assertThat(adapter.readChecksum(REF)).hasValueSatisfying(bytes->assertThat(bytes).containsExactly((byte)1));
        assertThat(closed).isTrue();
        assertThatThrownBy(()->adapter.readChecksum(REF)).isInstanceOf(Unavailable.class);
        verify(abort).run();
    }

    private ResponseInputStream<GetObjectResponse> checksumBody(long size, byte[] bytes, Runnable abort) {
        return new ResponseInputStream<>(GetObjectResponse.builder().contentLength(size).build(),
                AbortableInputStream.create(new ByteArrayInputStream(bytes), abort::run));
    }

    private S3Exception error(int status, String code) {
        return (S3Exception) S3Exception.builder().statusCode(status)
                .awsErrorDetails(AwsErrorDetails.builder().errorCode(code).build()).build();
    }
}
