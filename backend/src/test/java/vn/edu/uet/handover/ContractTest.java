package vn.edu.uet.handover;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.SpecVersion;
import io.swagger.v3.parser.OpenAPIV3Parser;
import io.swagger.v3.parser.core.models.ParseOptions;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ContractTest {
    private final Path contracts=Path.of("../contracts");
    private final ObjectMapper json=new ObjectMapper();
    @Test void openApiResolvesWithoutErrorsAndMarksScope() {
        ParseOptions options=new ParseOptions(); options.setResolve(true);
        var parsed=new OpenAPIV3Parser().readLocation(contracts.resolve("openapi.yaml").toString(),null,options);
        assertThat(parsed.getOpenAPI()).isNotNull();
        assertThat(parsed.getMessages()).isEmpty();
        parsed.getOpenAPI().getPaths().values().forEach(path -> path.readOperations().forEach(op ->
                assertThat(op.getExtensions().get("x-implementation-status")).isIn("implemented","contract-only")));
    }
    @Test void examplesMatchOpenApiSchemas() throws Exception {
        JsonNode api=new ObjectMapper(new YAMLFactory()).readTree(contracts.resolve("openapi.yaml").toFile());
        ObjectNode definitions=json.createObjectNode();
        api.at("/components/schemas").fields().forEachRemaining(e -> definitions.set(e.getKey(),convert(e.getValue())));
        Map<String,String> cases=new LinkedHashMap<>();
        cases.put("project-create.request.json","CreateProject"); cases.put("project-create.response.json","Project");
        cases.put("upload-init.request.json","UploadRequest"); cases.put("upload-init.response.json","UploadCreated");
        cases.put("upload-new-version.request.json","UploadRequest");
        cases.put("upload-complete.request.json","CompleteUpload");
        cases.put("upload-complete.response.json","UploadState"); cases.put("upload-verified.response.json","UploadState");
        cases.put("upload-mismatch.response.json","UploadState"); cases.put("handover-create.request.json","CreateHandover");
        cases.put("handover-ready.response.json","Handover"); cases.put("handover-confirm.response.json","Confirmation");
        try (var files=Files.list(contracts.resolve("examples"))) {
            files.filter(p -> p.getFileName().toString().startsWith("error-")).forEach(p -> cases.put(p.getFileName().toString(),"Error"));
        }
        var factory=JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V7);
        for (var entry:cases.entrySet()) {
            ObjectNode schema=json.createObjectNode();
            schema.setAll((ObjectNode)definitions.get(entry.getValue()));
            schema.set("definitions",definitions);
            var errors=factory.getSchema(schema).validate(json.readTree(contracts.resolve("examples/"+entry.getKey()).toFile()));
            assertThat(errors).as(entry.getKey()).isEmpty();
        }
    }
    @Test void checksumSchemaAcceptsResultsAndRejectsMissingIdentityAndFalseSuccess() throws Exception {
        var validator=JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V202012).getSchema(json.readTree(contracts.resolve("checksum-result.schema.json").toFile()));
        for (String file:new String[]{"checksum-success.json","checksum-failed.json"}) {
            assertThat(validator.validate(json.readTree(contracts.resolve("examples/"+file).toFile()))).as(file).isEmpty();
        }
        ObjectNode bad=(ObjectNode)json.readTree(contracts.resolve("examples/checksum-success.json").toFile());
        bad.remove("versionId"); assertThat(validator.validate(bad)).isNotEmpty();
        bad.put("versionId","null"); assertThat(validator.validate(bad)).isNotEmpty();
        bad.put("versionId","v1"); bad.putNull("actualSha256"); assertThat(validator.validate(bad)).isNotEmpty();
    }
    @Test void phaseOneSchemasRejectInvalidTypesNullsAndVersions() throws Exception {
        var project=schema("CreateProject");
        for (String body:new String[]{"{\"name\":123}","{\"name\":true}","{\"name\":null}","{\"name\":\"x\",\"description\":null}"}) {
            assertThat(project.validate(json.readTree(body))).as(body).isNotEmpty();
        }
        assertThat(project.validate(json.readTree("{\"name\":\"valid\"}"))).isEmpty();
        var upload=schema("UploadRequest");
        ObjectNode request=(ObjectNode)json.readTree(contracts.resolve("examples/upload-new-version.request.json").toFile());
        assertThat(upload.validate(request)).isEmpty();
        request.putNull("fileId"); assertThat(upload.validate(request)).isNotEmpty();
        request.remove("fileId"); assertThat(upload.validate(request)).isEmpty();
        request.put("role","OWNER"); assertThat(upload.validate(request)).isNotEmpty();
        var complete=schema("CompleteUpload");
        for (String body:new String[]{"{\"versionId\":\"null\"}","{\"versionId\":\" \"}","{\"versionId\":null}","{\"versionId\":123}","{\"versionId\":\"v1\",\"integrityStatus\":\"VERIFIED\"}"}) {
            assertThat(complete.validate(json.readTree(body))).as(body).isNotEmpty();
        }
        assertThat(complete.validate(json.readTree("{\"versionId\":\"opaque+version/v1=\"}"))).isEmpty();
    }
    com.networknt.schema.JsonSchema schema(String name) throws Exception {
        JsonNode api=new ObjectMapper(new YAMLFactory()).readTree(contracts.resolve("openapi.yaml").toFile());
        ObjectNode definitions=json.createObjectNode();
        api.at("/components/schemas").fields().forEachRemaining(e -> definitions.set(e.getKey(),convert(e.getValue())));
        ObjectNode schema=((ObjectNode)definitions.get(name)).deepCopy();
        schema.set("definitions",definitions);
        return JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V7).getSchema(schema);
    }
    private JsonNode convert(JsonNode source) {
        if (source.isArray()) {
            var out=json.createArrayNode(); source.forEach(n -> out.add(convert(n))); return out;
        }
        if (!source.isObject()) return source.deepCopy();
        ObjectNode out=json.createObjectNode();
        source.fields().forEachRemaining(e -> {
            if (e.getKey().equals("$ref")) out.put("$ref",e.getValue().asText().replace("#/components/schemas/","#/definitions/"));
            else if (!e.getKey().equals("nullable") && !e.getKey().equals("example")) out.set(e.getKey(),convert(e.getValue()));
        });
        if (source.path("nullable").asBoolean()) {
            ObjectNode nullable=json.createObjectNode();
            nullable.putArray("anyOf").add(out).add(json.createObjectNode().put("type","null"));
            return nullable;
        }
        return out;
    }
}
