import{readFileSync}from"node:fs";
import{describe,expect,it}from"vitest";
const sql=readFileSync(new URL("../migrations/0024_carousel_studio_persistence.sql",import.meta.url),"utf8");
describe("VS-77 persistence migration",()=>{
 it("persists editable slides, immutable renders and one approval binding",()=>{expect(sql).toContain("create table carousel_projects");expect(sql).toContain("create table carousel_project_slides");expect(sql).toContain("create table carousel_rendered_asset_versions");expect(sql).toContain("rendered_version_id text not null unique");expect(sql).toContain("unique(project_id)")});
 it("tracks publish lifecycle and verification identifiers",()=>{for(const column of["approved_asset_version_id","approved_media_fingerprint","lifecycle_status","meta_container_id","provider_publish_id","failure_reason","published_url"])expect(sql).toContain(column);expect(sql).toContain("publish_commands_processing_container_check");expect(sql).toContain("publish_commands_published_result_check")});
});
