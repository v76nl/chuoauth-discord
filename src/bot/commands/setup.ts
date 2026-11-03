import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    InteractionContextType,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
    type ButtonInteraction,
    type ChatInputCommandInteraction
} from "discord.js";
import type { VerifiedUserRepository } from "../../db/client.js";

export const VERIFY_BUTTON_ID = "chuoauth:verify";

export const setupCommand = new SlashCommandBuilder()
    .setName("setup-verify")
    .setDescription(
        "大学アカウント認証の案内メッセージをこのチャンネルに設置します"
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild);

export async function handleSetupCommand(
    interaction: ChatInputCommandInteraction
): Promise<void> {
    // 既定権限はサーバー設定で上書きできるため、実行時にも管理者か確認する
    if (
        !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    ) {
        await interaction.reply({
            content: "このコマンドは管理者のみ実行できます",
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const embed = new EmbedBuilder()
        .setTitle("大学アカウント認証")
        .setDescription(
            [
                "このサーバーは中央大学の学生向けです。",
                "下のボタンから、中央大学のGoogleアカウント (g.chuo-u.ac.jp) で認証すると認証済みロールが付与されます。",
                "",
                "記録されるのはDiscordのユーザーID、Googleアカウントの識別子、メールアドレス、学籍番号です。"
            ].join("\n")
        )
        .setColor(0x5865f2);
    const button = new ButtonBuilder()
        .setCustomId(VERIFY_BUTTON_ID)
        .setLabel("大学アカウントで認証する")
        .setStyle(ButtonStyle.Primary);

    await interaction.reply({
        embeds: [embed],
        components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(button)
        ]
    });
}

export async function handleVerifyButton(
    interaction: ButtonInteraction,
    deps: { loginUrl: string; repo: VerifiedUserRepository }
): Promise<void> {
    if (deps.repo.findByDiscordUserId(interaction.user.id)) {
        await interaction.reply({
            content: "このDiscordアカウントは認証済みです",
            flags: MessageFlags.Ephemeral
        });
        return;
    }
    const link = new ButtonBuilder()
        .setLabel("認証ページを開く")
        .setStyle(ButtonStyle.Link)
        .setURL(deps.loginUrl);
    await interaction.reply({
        content:
            "下のボタンから認証ページを開いてください。大学のGoogleアカウントでログインしたあと、Discordアカウントを連携します",
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(link)],
        flags: MessageFlags.Ephemeral
    });
}
