begin;

alter table content_assets drop constraint if exists content_assets_channel_check;
alter table content_assets add constraint content_assets_channel_check check(channel in ('linkedin','instagram','facebook','manual'));
alter table channel_accounts drop constraint if exists channel_accounts_channel_check;
alter table channel_accounts add constraint channel_accounts_channel_check check(channel in ('linkedin','instagram','facebook','manual'));
alter table publish_commands drop constraint if exists publish_commands_channel_check;
alter table publish_commands add constraint publish_commands_channel_check check(channel in ('linkedin','instagram','facebook','manual'));
alter table content_approvals drop constraint if exists content_approvals_destination_channel_check;
alter table content_approvals add constraint content_approvals_destination_channel_check check(destination_channel in ('linkedin','instagram','facebook','manual'));

alter table channel_accounts add column if not exists auth_method text;
update channel_accounts set auth_method=case when channel='instagram' then 'facebook-login' else 'provider-native' end where auth_method is null;
alter table channel_accounts alter column auth_method set default 'provider-native', alter column auth_method set not null;
alter table channel_accounts add constraint channel_accounts_auth_method_check check(auth_method in ('facebook-login','instagram-login','provider-native'));
alter table channel_accounts add constraint channel_accounts_auth_channel_check check((channel='facebook' and auth_method='facebook-login') or (channel='instagram' and auth_method in ('facebook-login','instagram-login')) or (channel in ('linkedin','manual') and auth_method='provider-native'));
alter table channel_accounts add column if not exists provider_user_ref text;

alter table channel_credentials drop constraint if exists channel_credentials_provider_check;
alter table channel_credentials add constraint channel_credentials_provider_check check(provider in ('meta-instagram','meta-instagram-login','meta-facebook'));
alter table channel_oauth_intents drop constraint if exists channel_oauth_intents_provider_check;
alter table channel_oauth_intents add constraint channel_oauth_intents_provider_check check(provider in ('meta-instagram','meta-instagram-login','meta-facebook'));
alter table channel_oauth_intents add column if not exists auth_method text;
update channel_oauth_intents set auth_method=case when provider='meta-instagram-login' then 'instagram' else 'facebook-instagram' end where auth_method is null;
alter table channel_oauth_intents alter column auth_method set not null;
alter table channel_oauth_intents add constraint channel_oauth_intents_auth_method_check check(auth_method in ('instagram','facebook-instagram','facebook'));

alter table channel_oauth_candidates alter column page_ref drop not null, alter column page_name drop not null;
alter table channel_oauth_candidates add column if not exists target_channel text, add column if not exists auth_method text;
update channel_oauth_candidates set target_channel='instagram',auth_method='facebook-login' where target_channel is null or auth_method is null;
alter table channel_oauth_candidates alter column target_channel set not null, alter column auth_method set not null;
alter table channel_oauth_candidates add constraint channel_oauth_candidates_target_channel_check check(target_channel in ('instagram','facebook'));
alter table channel_oauth_candidates add constraint channel_oauth_candidates_auth_method_check check(auth_method in ('instagram-login','facebook-login'));
alter table channel_oauth_candidates add constraint channel_oauth_candidates_auth_channel_check check(target_channel<>'facebook' or auth_method='facebook-login');

commit;
