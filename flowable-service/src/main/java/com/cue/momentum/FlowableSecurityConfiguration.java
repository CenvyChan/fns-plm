package com.cue.momentum;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class FlowableSecurityConfiguration {
    @Bean
    SecurityFilterChain flowableSecurity(HttpSecurity http) throws Exception {
        return http
            .csrf(csrf -> csrf.disable())
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/health", "/actuator/health/**").permitAll()
                .anyRequest().authenticated())
            .httpBasic(Customizer.withDefaults())
            .build();
    }

    @Bean
    PasswordEncoder flowablePasswordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    UserDetailsService flowableApiUser(
        PasswordEncoder encoder,
        @Value("${momentum.flowable.username}") String username,
        @Value("${momentum.flowable.password}") String password
    ) {
        if (password == null || password.isBlank() || password.length() < 24) {
            throw new IllegalStateException("FLOWABLE_REST_PASSWORD must be set to a random secret of at least 24 characters.");
        }
        var user = User.withUsername(username)
            .password(encoder.encode(password))
            .roles("ACTIVITI_USER", "ACTIVITI_ADMIN")
            .build();
        return new InMemoryUserDetailsManager(user);
    }
}
